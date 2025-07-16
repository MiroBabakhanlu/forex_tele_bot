const express = require('express');
const puppeteer = require('puppeteer-core');
const TelegramBot = require('node-telegram-bot-api');
const { exec } = require('child_process');
const translate = require('@vitalets/google-translate-api').translate;
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = 8080;

// Configuration
const CHROME_PATH = process.env.CHROME_PATH;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Initialize Telegram Bot
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD'];

// Ensure user_logs directory exists
const userLogsDir = path.join(__dirname, 'user_logs');
if (!fs.existsSync(userLogsDir)) {
  fs.mkdirSync(userLogsDir);
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
        ...currencies.map(curr => [{
          text: curr,
          callback_data: `currency_${curr}`
        }]),
        [{
          text: 'تحلیل تکنیکال',
          callback_data: 'technical_analysis'
        }]
      ]
    }
  };
  bot.sendMessage(chatId, 'یک ارز یا تحلیل تکنیکال را انتخاب کنید:', opts);
});

// Handle technical analysis option
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

async function sendForexData(chatId, impactLevel, selectedCurrency, periodQuery = '') {
  try {
    const username = 'unknown'; // In a real scenario, you'd get this from context
    const loadingMsg = await bot.sendMessage(chatId, `در حال دریافت رویدادهای ${impactLevel} برای ${selectedCurrency}...`);
    const forexData = await getForexFactoryData(impactLevel, selectedCurrency, periodQuery);

    let response = `📅 *${await translateText(forexData.week)}*\n`;
    response += `رویدادهای ${selectedCurrency} با ${impactLevel}: ${forexData.count}\n\n`;

    if (forexData.events.length === 0) {
      response += `هیچ رویدادی برای معیارهای انتخاب شده یافت نشد.`;
    } else {
      for (const event of forexData.events) {
        response += `⏰ *${event.time}* (${event.currency})\n`;
        response += `🔢 مقدار واقعی: ${event.actual} | پیش‌بینی: ${event.forecast} | قبلی: ${event.previous}\n\n`;
      }
    }
        // response += `📌 ${await translateText(event.event)}\n`;


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
    const username = 'unknown'; // In a real scenario, you'd get this from context
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

// Add this helper function for translation
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

async function getForexFactoryData(impactLevel = 'High Impact Expected', selectedCurrency, periodQuery = '') {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: CHROME_PATH,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/114.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 800 });

    const url = `https://www.forexfactory.com/calendar${periodQuery}`;
    await page.goto(url, { waitUntil: 'networkidle2' });
    await page.waitForSelector('tr.calendar__row[data-event-id]');

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
