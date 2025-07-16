const express = require('express');
const puppeteer = require('puppeteer-core');
const TelegramBot = require('node-telegram-bot-api');
const { exec } = require('child_process');
const translate = require('@vitalets/google-translate-api').translate;
const fs = require('fs');
const path = require('path');
const userAgent = require('user-agents');
const proxyChain = require('proxy-chain');
const {default: delay} = require('delay');
const randomUseragent = require('random-useragent');
require('dotenv').config();

const app = express();
const PORT = 8080;

// Configuration
const CHROME_PATH = process.env.CHROME_PATH;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PROXY_LIST = process.env.PROXY_LIST ? process.env.PROXY_LIST.split(',') : [];

// Initialize Telegram Bot
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD'];

// Ensure user_logs directory exists
const userLogsDir = path.join(__dirname, 'user_logs');
if (!fs.existsSync(userLogsDir)) {
  fs.mkdirSync(userLogsDir);
}

// Helper function to get a random proxy
function getRandomProxy() {
  if (PROXY_LIST.length === 0) return null;
  const randomIndex = Math.floor(Math.random() * PROXY_LIST.length);
  return PROXY_LIST[randomIndex];
}

// Helper function to log user activity
async function logUserActivity(chatId, username, action, details = {}) {
  try {
    const timestamp = new Date().toISOString();
    const logEntry = `${timestamp} - ${action}\nDetails: ${JSON.stringify(details)}\n\n`;
    const logFilePath = path.join(userLogsDir, `${chatId}_${username || 'anonymous'}.txt`);
    
    // Append to log file or create new one
    fs.appendFileSync(logFilePath, logEntry);
  } catch (error) {
    console.error('Error logging user activity:', error);
  }
}

// Handle /start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || 'anonymous';
  
  // Log the start command
  logUserActivity(chatId, username, '/start command received', {
    firstName: msg.from.first_name,
    lastName: msg.from.last_name
  });

  const opts = {
    reply_markup: {
      inline_keyboard: [
        [{
          text: 'تحلیل فاندامنتال',
          callback_data: 'fundamental_analysis'
        }],
        [{
          text: 'تحلیل تکنیکال',
          callback_data: 'technical_analysis'
        }]
      ]
    }
  };
  bot.sendMessage(chatId, 'لطفا نوع تحلیل را انتخاب کنید:', opts);
});

// Handle callback queries
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const username = callbackQuery.from.username || 'anonymous';
  const data = callbackQuery.data;

  // Log the callback query
  logUserActivity(chatId, username, 'callback_query received', {
    data: data
  });

  if (data === 'technical_analysis') {
    const loadingMsg = await bot.sendMessage(chatId, 'در حال اجرای تحلیل تکنیکال...');
    
    exec(`python technical_analysis.py`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Execution error: ${error.message}`);
        logUserActivity(chatId, username, 'technical_analysis error', {
          error: error.message
        });
        return bot.editMessageText('خطا در اجرای اسکریپت تحلیل تکنیکال.', {
          chat_id: chatId,
          message_id: loadingMsg.message_id
        });
      }
      if (stderr) {
        console.error(`Script stderr: ${stderr}`);
        logUserActivity(chatId, username, 'technical_analysis stderr', {
          stderr: stderr
        });
      }
      
      logUserActivity(chatId, username, 'technical_analysis completed', {
        output: stdout
      });
      
      bot.editMessageText(stdout || 'تحلیل تکنیکال کامل شد.', {
        chat_id: chatId,
        message_id: loadingMsg.message_id
      });
    });
  } else if (data === 'fundamental_analysis') {
    // Show currency selection for fundamental analysis
    const opts = {
      reply_markup: {
        inline_keyboard: [
          ...currencies.map(curr => [{
            text: curr,
            callback_data: `currency_${curr}`
          }])
        ]
      }
    };
    bot.sendMessage(chatId, 'یک ارز را برای تحلیل فاندامنتال انتخاب کنید:', opts);
  } else if (data.startsWith('currency_')) {
    const currency = data.split('_')[1];
    const opts = {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'High Impact', callback_data: `impact_high_${currency}` }],
          [{ text: 'Medium Impact', callback_data: `impact_medium_${currency}` }]
        ]
      }
    };
    bot.sendMessage(chatId, `ارز ${currency} انتخاب شد. حالا سطح تاثیر را انتخاب کنید:`, opts);
  } else if (data.startsWith('impact_')) {
    const [, impact, currency] = data.split('_');
    const impactLevel = impact === 'high' ? 'High Impact Expected' : 'Medium Impact Expected';
    
    // Log impact level selection
    logUserActivity(chatId, username, 'impact level selected', {
      currency: currency,
      impact: impactLevel
    });
    
    // Show time period selection
    const opts = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Today', callback_data: `period_today_${impact}_${currency}` },
            { text: 'Tomorrow', callback_data: `period_tomorrow_${impact}_${currency}` }
          ],
          [
            { text: 'This Week', callback_data: `period_thisweek_${impact}_${currency}` },
            { text: 'Next Week', callback_data: `period_nextweek_${impact}_${currency}` }
          ],
          [
            { text: 'This Month', callback_data: `period_thismonth_${impact}_${currency}` },
            { text: 'Next Month', callback_data: `period_nextmonth_${impact}_${currency}` }
          ],
          [
            { text: 'Yesterday', callback_data: `period_yesterday_${impact}_${currency}` },
            { text: 'Last Week', callback_data: `period_lastweek_${impact}_${currency}` }
          ],
          [
            { text: 'Last Month', callback_data: `period_lastmonth_${impact}_${currency}` }
          ]
        ]
      }
    };
    
    bot.sendMessage(chatId, `سطح تاثیر ${impactLevel} برای ${currency} انتخاب شد. حالا دوره زمانی را انتخاب کنید:`, opts);
  } else if (data.startsWith('period_')) {
    const parts = data.split('_');
    const period = parts[1];
    const impact = parts[2];
    const currency = parts[3];
    
    const impactLevel = impact === 'high' ? 'High Impact Expected' : 'Medium Impact Expected';
    const periodMap = {
      'today': '?day=today',
      'tomorrow': '?day=tomorrow',
      'thisweek': '?week=this',
      'nextweek': '?week=next',
      'thismonth': '?month=this',
      'nextmonth': '?month=next',
      'yesterday': '?day=yesterday',
      'lastweek': '?week=last',
      'lastmonth': '?month=last'
    };
    
    const periodQuery = periodMap[period];
    
    // Log period selection
    logUserActivity(chatId, username, 'period selected', {
      currency: currency,
      impact: impactLevel,
      period: period,
      periodQuery: periodQuery
    });
    
    await sendForexData(chatId, impactLevel, currency, periodQuery);
  }
});

async function getForexFactoryData(impactLevel = 'High Impact Expected', selectedCurrency, periodQuery = '') {
  let browser;
  let proxyUrl = null;
  let newProxyUrl = null;
  
  try {
    // Get a random proxy if available
    const randomProxy = getRandomProxy();
    if (randomProxy) {
      proxyUrl = randomProxy;
      newProxyUrl = await proxyChain.anonymizeProxy(proxyUrl);
    }

    // Random delay between 1-5 seconds
    const randomDelay = Math.floor(Math.random() * 4000) + 1000;
    console.log(randomDelay, 'ms delay before launching browser');
    await delay(randomDelay);

    // Get a random user agent
    const randomAgent = randomUseragent.getRandom();
    console.log('Using random user agent:', randomAgent);

    const browserOptions = {
      headless: true,
      executablePath: CHROME_PATH,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    };

    // Add proxy if available
    if (newProxyUrl) {
      browserOptions.args.push(`--proxy-server=${newProxyUrl}`);
    }

    browser = await puppeteer.launch(browserOptions);

    const page = await browser.newPage();
    
    // Set random user agent
    await page.setUserAgent(randomAgent);
    
    // Set viewport to look more like a real user
    await page.setViewport({
      width: 1280 + Math.floor(Math.random() * 100),
      height: 800 + Math.floor(Math.random() * 100),
      deviceScaleFactor: 1,
      hasTouch: Math.random() > 0.5,
      isLandscape: Math.random() > 0.5
    });

    // Enable stealth mode with more human-like behavior
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
    });

    const url = `https://www.forexfactory.com/calendar${periodQuery}`;
    
    // Random navigation delay
    await delay(Math.floor(Math.random() * 3000));
    
    await page.goto(url, { 
      waitUntil: 'networkidle2',
      timeout: 60000 
    });
    
    // Random delay before interacting with the page
    await delay(Math.floor(Math.random() * 2000) + 1000);
    
    await page.waitForSelector('tr.calendar__row[data-event-id]', { timeout: 30000 });

    // Trigger auto-scroll to load lazy events
    await autoScroll(page);

    // Optional extra wait for JS to finish loading all data
    await delay(1000);

    const { week, events } = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tr.calendar__row[data-event-id]'));
      let lastDate = '';
      
      const evts = rows.map(row => {
        const getText = sel => row.querySelector(sel)?.textContent.trim() || '';
        const impactEl = row.querySelector('.calendar__impact span');
        
        // Get date and handle missing values
        const date = getText('.calendar__date span:last-child');
        if (date) lastDate = date;

        return {
          date: lastDate, // Use the last known date if missing
          time: getText('.calendar__time span'),
          currency: getText('.calendar__currency'),
          impact: impactEl?.getAttribute('title') || 'No Impact',
          event: getText('.calendar__event-title'),
          actual: getText('.calendar__actual') || 'N/A',
          forecast: getText('.calendar__forecast') || 'N/A',
          previous: getText('.calendar__previous') || 'N/A'
        };
      });

      const weekLabel = document.querySelector('.calendar__options h2 span')?.textContent.trim() || '';
      return { week: weekLabel, events: evts };
    });

    const filteredEvents = events.filter(event =>
      event.impact === impactLevel &&
      event.currency === selectedCurrency
    );

    return {
      source: 'Forex Factory',
      week,
      count: filteredEvents.length,
      events: filteredEvents
    };

  } catch (err) {
    console.error('Puppeteer scrape error:', err);
    throw err;
  } finally {
    if (browser) await browser.close();
    if (newProxyUrl) await proxyChain.closeAnonymizedProxy(newProxyUrl, true);
  }
}


async function sendForexData(chatId, impactLevel, selectedCurrency, periodQuery = '') {
  try {
    const username = 'unknown';
    const loadingMsg = await bot.sendMessage(chatId, `در حال دریافت رویدادهای ${impactLevel} برای ${selectedCurrency}...`);
    const forexData = await getForexFactoryData(impactLevel, selectedCurrency, periodQuery);

    let response = `📅 *${await translateText(forexData.week)}*\n`;
    response += `رویدادهای ${selectedCurrency} با ${impactLevel}: ${forexData.count}\n\n`;

    if (forexData.events.length === 0) {
      response += `هیچ رویدادی برای معیارهای انتخاب شده یافت نشد.`;
    } else {
      let currentDate = '';
      for (const event of forexData.events) {
        // Only show date when it changes
        if (event.date && event.date !== currentDate) {
          response += `\n🗓 *${event.date}*\n`;
          currentDate = event.date;
        }
        
        // Build event line
        let eventLine = '';
        if (event.time) {
          eventLine += `⏰ ${event.time} `;
        }
        eventLine += `(${event.currency}) `;
        eventLine += `📌 ${await translateText(event.event)}\n`;
        
        // Add event details
        eventLine += `🔢 مقدار واقعی: ${event.actual} | پیش‌بینی: ${event.forecast} | قبلی: ${event.previous}\n\n`;
        
        response += eventLine;
      }
    }

    await bot.editMessageText(response, {
      chat_id: chatId,
      message_id: loadingMsg.message_id,
      parse_mode: 'Markdown'
    });

    // Log successful data retrieval
    logUserActivity(chatId, username, 'forex data retrieved', {
      currency: selectedCurrency,
      impactLevel: impactLevel,
      periodQuery: periodQuery,
      eventCount: forexData.count
    });

  } catch (error) {
    const username = 'unknown';
    bot.sendMessage(chatId, `خطا در دریافت اطلاعات: ${error.message}`);
    
    // Log error
    logUserActivity(chatId, username, 'forex data error', {
      error: error.message,
      currency: selectedCurrency,
      impactLevel: impactLevel,
      periodQuery: periodQuery
    });
  }
}


// Helper function for translation
async function translateText(text) {
  try {
    if (!text || text === 'N/A') return text;
    const result = await translate(text, { to: 'fa' });
    return result.text;
  } catch (error) {
    console.error('Translation error:', error);
    return text;
  }
}

// Auto-scroll function to load all data
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 200;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
}

async function getForexFactoryData(impactLevel = 'High Impact Expected', selectedCurrency, periodQuery = '') {
  let browser;
  let proxyUrl = null;
  let newProxyUrl = null;
  
  try {
    // Get a random proxy if available
    const randomProxy = getRandomProxy();
    if (randomProxy) {
      proxyUrl = randomProxy;
      newProxyUrl = await proxyChain.anonymizeProxy(proxyUrl);
    }

    // Random delay between 1-5 seconds
    const randomDelay = Math.floor(Math.random() * 4000) + 1000;
    console.log(randomDelay, 'ms delay before launching browser');
    await delay(randomDelay);

    // Get a random user agent
    const randomAgent = randomUseragent.getRandom();
    console.log('Using random user agent:', randomAgent);

    const browserOptions = {
      headless: true,
      executablePath: CHROME_PATH,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    };

    // Add proxy if available
    if (newProxyUrl) {
      browserOptions.args.push(`--proxy-server=${newProxyUrl}`);
    }

    browser = await puppeteer.launch(browserOptions);

    const page = await browser.newPage();
    
    // Set random user agent
    await page.setUserAgent(randomAgent);
    
    // Set viewport to look more like a real user
    await page.setViewport({
      width: 1280 + Math.floor(Math.random() * 100),
      height: 800 + Math.floor(Math.random() * 100),
      deviceScaleFactor: 1,
      hasTouch: Math.random() > 0.5,
      isLandscape: Math.random() > 0.5
    });

    // Enable stealth mode with more human-like behavior
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
    });

    const url = `https://www.forexfactory.com/calendar${periodQuery}`;
    
    // Random navigation delay
    await delay(Math.floor(Math.random() * 3000));
    
    await page.goto(url, { 
      waitUntil: 'networkidle2',
      timeout: 60000 
    });
    
    // Random delay before interacting with the page
    await delay(Math.floor(Math.random() * 2000) + 1000);
    
    await page.waitForSelector('tr.calendar__row[data-event-id]', { timeout: 30000 });

    // Trigger auto-scroll to load lazy events
    await autoScroll(page);

    // Optional extra wait for JS to finish loading all data
    await delay(1000);

    const { week, events } = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tr.calendar__row[data-event-id]'));
      const evts = rows.map(row => {
        const getText = sel => row.querySelector(sel)?.textContent.trim() || '';
        const impactEl = row.querySelector('.calendar__impact span');
        return {
          date: getText('.calendar__date span:last-child'),
          time: getText('.calendar__time span'),
          currency: getText('.calendar__currency'),
          impact: impactEl?.getAttribute('title') || 'No Impact',
          event: getText('.calendar__event-title'),
          actual: getText('.calendar__actual') || 'N/A',
          forecast: getText('.calendar__forecast') || 'N/A',
          previous: getText('.calendar__previous') || 'N/A'
        };
      });
      const weekLabel = document.querySelector('.calendar__options h2 span')?.textContent.trim() || '';
      return { week: weekLabel, events: evts };
    });

    const filteredEvents = events.filter(event =>
      event.impact === impactLevel &&
      event.currency === selectedCurrency
    );

    return {
      source: 'Forex Factory',
      week,
      count: filteredEvents.length,
      events: filteredEvents
    };

  } catch (err) {
    console.error('Puppeteer scrape error:', err);
    throw err;
  } finally {
    if (browser) await browser.close();
    if (newProxyUrl) await proxyChain.closeAnonymizedProxy(newProxyUrl, true);
  }
}

// API endpoint for technical analysis
app.get('/exec', (req, res) => {
  const chatId = req.query.chatId || 'api_call';
  const username = req.query.username || 'api_user';
  
  logUserActivity(chatId, username, 'API call to /exec');
  
  exec(`python technical_analysis.py`, (error, stdout, stderr) => {
    if (error) {
      console.error(`Execution error: ${error.message}`);
      logUserActivity(chatId, username, 'API /exec error', {
        error: error.message
      });
      return res.status(500).json({ error: 'Python script failed', details: error.message });
    }
    if (stderr) {
      console.error(`Script stderr: ${stderr}`);
      logUserActivity(chatId, username, 'API /exec stderr', {
        stderr: stderr
      });
    }
    
    logUserActivity(chatId, username, 'API /exec success', {
      output: stdout
    });
    
    res.type('text/plain').send(stdout);
  });
});

// API endpoint for forex data
app.get('/scrape', async (req, res) => {
  const chatId = req.query.chatId || 'api_call';
  const username = req.query.username || 'api_user';
  
  logUserActivity(chatId, username, 'API call to /scrape');
  
  try {
    const data = await getForexFactoryData();
    
    logUserActivity(chatId, username, 'API /scrape success', {
      eventCount: data.count
    });
    
    res.json(data);
  } catch (err) {
    console.error('Error:', err);
    
    logUserActivity(chatId, username, 'API /scrape error', {
      error: err.message
    });
    
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Telegram bot is listening for commands...`);
  console.log(`User logs will be saved in: ${userLogsDir}`);
});