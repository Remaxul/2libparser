const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs').promises;

// Настройки Telegram
const TELEGRAM_TOKEN = '7552508743:AAEmGQw499vk_94gzzbHh4drkZdsd45Zz9Q'; // Замени на токен твоего бота
const TELEGRAM_CHANNEL_ID = '-1002619055628'; // Замени на ID твоего канала
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

// Функция для получения текущего времени в формате ГГГГ-ММ-ДД ЧЧ:ММ:СС
function getFormattedTime() {
  const now = new Date();
  return now.toISOString().replace('T', ' ').split('.')[0];
}

// Функция для получения коллекций с указанной страницы
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

// Функция для проверки существования файла
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Функция для чтения tracked_ids.json
async function readTrackedIds() {
  try {
    const data = await fs.readFile('tracked_ids.json', 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`${getFormattedTime()} Ошибка при чтении tracked_ids.json: ${error.message}`);
    return { ids: [], maxId: 0 };
  }
}

// Функция для сохранения данных в файл
async function saveCollectionsToFile(collections, filename) {
  try {
    await fs.writeFile(filename, JSON.stringify(collections, null, 2));
    console.log(`${getFormattedTime()} Данные сохранены в ${filename}`);
  } catch (error) {
    console.error(`${getFormattedTime()} Ошибка при сохранении файла ${filename}: ${error.message}`);
  }
}

// Функция для сохранения tracked_ids.json
async function saveTrackedIds(ids, maxId) {
  try {
    await fs.writeFile('tracked_ids.json', JSON.stringify({ ids, maxId }, null, 2));
    console.log(`${getFormattedTime()} Файл tracked_ids.json обновлён`);
  } catch (error) {
    console.error(`${getFormattedTime()} Ошибка при сохранении tracked_ids.json: ${error.message}`);
  }
}

// Функция для отправки уведомления в Telegram
async function sendTelegramNotification(collection, site) {
  const url = site === 'mangalib' 
    ? `https://mangalib.me/ru/collections/${collection.id}`
    : `https://v2.shlib.life/ru/collections/${collection.id}`;
  const siteName = site === 'mangalib' ? 'Mangalib' : 'Shlib';
  const message = `Новая коллекция: *${collection.name}*\nСайт: ${siteName}\nСсылка: ${url}`;
  try {
    await bot.sendMessage(TELEGRAM_CHANNEL_ID, message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true 
    });
    console.log(`${getFormattedTime()} Уведомление отправлено для коллекции ${collection.id}`);
  } catch (error) {
    console.error(`${getFormattedTime()} Ошибка при отправке уведомления в Telegram: ${error.message}`);
  }
}

// Функция для полного парсинга всех страниц для одного сайта
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

// Функция для парсинга 20 самых новых ID для одного сайта
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

// Основная функция для парсинга и обработки
async function parseAndProcess() {
  console.log(`${getFormattedTime()} Запуск парсинга...`);

  // Параметры для mangalib.me
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

  // Параметры для v2.shlib.life
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

  // Полный парсинг обоих сайтов
  console.log(`${getFormattedTime()} Начинаем полный парсинг mangalib.me...`);
  const mangalibCollections = await parseAllCollections(mangalibConfig.apiUrl, mangalibConfig.headers, mangalibConfig.outputFile);
  
  console.log(`${getFormattedTime()} Начинаем полный парсинг v2.shlib.life...`);
  const shlibCollections = await parseAllCollections(shlibConfig.apiUrl, shlibConfig.headers, shlibConfig.outputFile);

  // Парсинг 20 самых новых коллекций
  console.log(`${getFormattedTime()} Начинаем парсинг топ 20 для mangalib.me...`);
  const mangalibTop20 = await parseTop20Collections(mangalibConfig.apiUrl, mangalibConfig.headers, mangalibConfig.site);
  
  console.log(`${getFormattedTime()} Начинаем парсинг топ 20 для v2.shlib.life...`);
  const shlibTop20 = await parseTop20Collections(shlibConfig.apiUrl, shlibConfig.headers, shlibConfig.site);

  // Объединяем топ 20 коллекций, отдавая приоритет mangalib.me для дубликатов
  const allTopCollections = [];
  const seenIds = new Set();

  // Сначала добавляем коллекции с mangalib.me
  for (const collection of mangalibTop20) {
    allTopCollections.push(collection);
    seenIds.add(collection.id);
  }

  // Добавляем коллекции с shlib.life, только если ID ещё не встречался
  for (const collection of shlibTop20) {
    if (!seenIds.has(collection.id)) {
      allTopCollections.push(collection);
      seenIds.add(collection.id);
    }
  }

  // Извлекаем ID, удаляем дубликаты (хотя они уже обработаны)
  const currentIds = [...new Set(allTopCollections.map(c => c.id))];
  const collectionsById = Object.fromEntries(allTopCollections.map(c => [c.id, c]));

  // Читаем предыдущие ID и maxId
  const isFirstRun = !(await fileExists('tracked_ids.json'));
  const { ids: previousIds, maxId: previousMaxId } = await readTrackedIds();

  // Находим новые ID, которые больше предыдущего максимума
  const newIds = currentIds.filter(id => id > previousMaxId && !previousIds.includes(id));

  // Отправляем уведомления, только если это не первый запуск
  if (!isFirstRun) {
    for (const id of newIds) {
      const collection = collectionsById[id];
      await sendTelegramNotification(collection, collection.site);
    }
  }

  // Обновляем список ID, убирая дубликаты
  const updatedIds = [...new Set([...previousIds, ...currentIds])];
  const newMaxId = Math.max(...updatedIds, previousMaxId);

  // Сохраняем обновлённый список
  await saveTrackedIds(updatedIds, newMaxId);

  console.log(`${getFormattedTime()} Парсинг завершён. Первый запуск: ${isFirstRun}, Новых ID: ${newIds.length}, Всего ID: ${updatedIds.length}, Макс. ID: ${newMaxId}`);
}

// Запускаем парсинг каждую минуту
setInterval(parseAndProcess, 60 * 1000);

// Выполняем первый запуск сразу
parseAndProcess();