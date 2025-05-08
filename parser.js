const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs').promises;
const http = require('http');
const path = require('path');

// Тг
const TELEGRAM_TOKEN = '7875890659:AAFqkDJFpoOF68T58_z84IEsi9OHDxER_kU'; // Заменить
const TELEGRAM_CHANNEL_ID = '-1002589466518'; // Заменить
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

// Конфигурация уведомлений
const ENABLE_MANGALIB_NOTIFICATIONS = true; // Измени на false, чтобы отключить уведомления для mangalib
const ENABLE_SHLIB_NOTIFICATIONS = false; // Измени на false, чтобы отключить уведомления для shlib

// Время в отладочных сообщениях
function getFormattedTime() {
  const now = new Date();
  return now.toISOString().replace('T', ' ').split('.')[0];
}

async function getNPageCollection(pageNum, apiUrl, headers) {
  try {
    const resp = await fetch(`${apiUrl}?limit=24&page=${pageNum}&sort_by=newest`, {
      headers,
      method: 'GET',
      mode: 'cors',
    });

    if (!resp.ok) {
      throw new Error(`Ошибка HTTP: ${resp.status}`);
    }

    const res = await resp.json();
    return res;
  } catch (error) {
    console.error(`${getFormattedTime()} Ошибка при запросе страницы ${pageNum} для ${apiUrl}: ${error.message}`);
    return null;
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readTrackedIds() {
  try {
    const data = await fs.readFile('tracked_ids.json', 'utf8');
    const parsed = JSON.parse(data);
    return { ids: [], maxId: parsed.maxId || 0 }; // Возвращаем только maxId, ids формируем заново
  } catch (error) {
    console.error(`${getFormattedTime()} Ошибка при чтении tracked_ids.json: ${error.message}`);
    return { ids: [], maxId: 0 };
  }
}

async function saveCollectionsToFile(collections, filename) {
  try {
    await fs.writeFile(filename, JSON.stringify(collections, null, 2));
    console.log(`${getFormattedTime()} Данные сохранены в ${filename}`);
  } catch (error) {
    console.error(`${getFormattedTime()} Ошибка при сохранении файла ${filename}: ${error.message}`);
  }
}

async function saveTrackedIds(ids, maxId) {
  try {
    await fs.writeFile('tracked_ids.json', JSON.stringify({ ids, maxId }, null, 2));
    console.log(`${getFormattedTime()} Файл tracked_ids.json обновлён`);
  } catch (error) {
    console.error(`${getFormattedTime()} Ошибка при сохранении tracked_ids.json: ${error.message}`);
  }
}

async function sendTelegramNotification(collection, site) {
  const url = site === 'mangalib'
    ? `https://mangalib.me/ru/collections/${collection.id}`
    : `https://v2.shlib.life/ru/collections/${collection.id}`;
  const siteName = site === 'mangalib' ? 'Mangalib' : 'Shlib';
  const message = `Новая коллекция: *${collection.name}*\nСайт: ${siteName}\nСсылка: ${url}`;
  try {
    if ((site === 'mangalib' && ENABLE_MANGALIB_NOTIFICATIONS) || (site === 'shlib' && ENABLE_SHLIB_NOTIFICATIONS)) {
      await bot.sendMessage(TELEGRAM_CHANNEL_ID, message, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });
      console.log(`${getFormattedTime()} Уведомление отправлено для коллекции ${collection.id} (сайт: ${siteName})`);
    } else {
      console.log(`${getFormattedTime()} Уведомление для коллекции ${collection.id} (сайт: ${siteName}) пропущено (отключено)`);
    }
  } catch (error) {
    console.error(`${getFormattedTime()} Ошибка при отправке уведомления в Telegram: ${error.message}`);
  }
}

async function parseAllCollections(apiUrl, headers, outputFile) {
  const allCollections = [];
  let page = 1;
  let hasNextPage = true;

  while (hasNextPage) {
    console.log(`${getFormattedTime()} Запрашиваем страницу ${page} для ${apiUrl}...`);
    const data = await getNPageCollection(page, apiUrl, headers);

    if (data && data.data && data.data.length > 0) {
      allCollections.push(...data.data);
      hasNextPage = (data.meta && data.meta.has_next) || data.data.length === 24;
      page++;
      await new Promise(resolve => setTimeout(resolve, 10));
    } else {
      console.log(`${getFormattedTime()} Нет данных для страницы ${page} для ${apiUrl}, завершаем парсинг.`);
      hasNextPage = false;
    }
  }

  if (allCollections.length > 0) {
    await saveCollectionsToFile(allCollections, outputFile);
    console.log(`${getFormattedTime()} Всего собрано коллекций для ${apiUrl}: ${allCollections.length}`);
  } else {
    console.log(`${getFormattedTime()} Нет данных для сохранения для ${apiUrl}`);
  }

  return allCollections;
}

async function parseTop20Collections(apiUrl, headers, site) {
  const collections = [];
  let page = 1;

  while (collections.length < 20) {
    console.log(`${getFormattedTime()} Запрашиваем страницу ${page} для ${apiUrl} (топ 20)...`);
    const data = await getNPageCollection(page, apiUrl, headers);

    if (data && data.data && data.data.length > 0) {
      collections.push(...data.data);
      page++;
      await new Promise(resolve => setTimeout(resolve, 10));
    } else {
      console.log(`${getFormattedTime()} Нет данных для страницы ${page} для ${apiUrl}`);
      break;
    }
  }

  return collections.slice(0, 20).map(c => ({
    id: c.id,
    name: c.name,
    site
  }));
}

// HTTP-сервер
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'origin, content-type, accept');
  const routes = {
    '/mangalib': 'mangalib_collections.json',
    '/shlib': 'shlib_collections.json',
    '/tracked': 'tracked_ids.json'
  };

  const filePath = routes[req.url];

  if (filePath) {
    try {
      const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
      if (!fileExists) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: `File ${filePath} not found` }));
        return;
      }

      const data = await fs.readFile(filePath, 'utf8');
      res.statusCode = 200;
      res.end(data);
    } catch (error) {
      console.error(`${getFormattedTime()} Ошибка при чтении файла ${filePath}: ${error.message}`);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  } else {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Route not found' }));
  }
});

server.listen(3000, '0.0.0.0', () => {
  console.log(`${getFormattedTime()} HTTP-сервер запущен на порту 3000`);
});

async function parseAndProcess() {
  console.log(`${getFormattedTime()} Запуск парсинга...`);

  const mangalibConfig = {
    apiUrl: 'https://api.cdnlibs.org/api/collections',
    headers: {
      'Site-Id': '1',
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://mangalib.me/',
    },
    outputFile: 'mangalib_collections.json',
    site: 'mangalib',
  };

  const shlibConfig = {
    apiUrl: 'https://v2.shlib.life/api/collections',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://v2.shlib.life/',
    },
    outputFile: 'shlib_collections.json',
    site: 'shlib',
  };

  console.log(`${getFormattedTime()} Начинаем полный парсинг mangalib.me...`);
  const mangalibCollections = await parseAllCollections(mangalibConfig.apiUrl, mangalibConfig.headers, mangalibConfig.outputFile);

  console.log(`${getFormattedTime()} Начинаем полный парсинг v2.shlib.life...`);
  const shlibCollections = await parseAllCollections(shlibConfig.apiUrl, shlibConfig.headers, shlibConfig.outputFile);

  console.log(`${getFormattedTime()} Начинаем парсинг топ 20 для mangalib.me...`);
  const mangalibTop20 = await parseTop20Collections(mangalibConfig.apiUrl, mangalibConfig.headers, mangalibConfig.site);

  console.log(`${getFormattedTime()} Начинаем парсинг топ 20 для v2.shlib.life...`);
  const shlibTop20 = await parseTop20Collections(shlibConfig.apiUrl, shlibConfig.headers, shlibConfig.site);

  // Объединение 20 коллекций с приоритетом mangalib → shlib
  const allTopCollections = [];
  const seenIds = new Set();

  for (const collection of mangalibTop20) {
    allTopCollections.push(collection);
    seenIds.add(collection.id);
  }

  for (const collection of shlibTop20) {
    if (!seenIds.has(collection.id)) {
      allTopCollections.push(collection);
      seenIds.add(collection.id);
    }
  }

  const currentIds = [...new Set(allTopCollections.map(c => c.id))];
  const collectionsById = Object.fromEntries(allTopCollections.map(c => [c.id, c]));

  const isFirstRun = !(await fileExists('tracked_ids.json'));
  const { maxId: previousMaxId } = await readTrackedIds();

  const newIds = currentIds.filter(id => id > previousMaxId);

  if (!isFirstRun) {
    for (const id of newIds) {
      const collection = collectionsById[id];
      if (ENABLE_MANGALIB_NOTIFICATIONS || (collection.site === 'shlib' && ENABLE_SHLIB_NOTIFICATIONS)) {
        await sendTelegramNotification(collection, collection.site === 'mangalib' && !ENABLE_MANGALIB_NOTIFICATIONS && ENABLE_SHLIB_NOTIFICATIONS ? 'shlib' : collection.site);
      } else {
        console.log(`${getFormattedTime()} Уведомление для коллекции ${collection.id} пропущено (оба сайта отключены)`);
      }
    }
  }

  const newMaxId = Math.max(...currentIds, previousMaxId);
  await saveTrackedIds(currentIds, newMaxId);

  console.log(`${getFormattedTime()} Парсинг завершён. Первый запуск: ${isFirstRun}, Новых ID: ${newIds.length}, Всего ID: ${currentIds.length}, Макс. ID: ${newMaxId}`);
}

setInterval(parseAndProcess, 60 * 1000);

parseAndProcess();