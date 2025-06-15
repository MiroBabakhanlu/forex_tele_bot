const express = require('express');
const puppeteer = require('puppeteer-core');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();
const PORT = 3000;

// Configuration
const CHROME_PATH = process.env.CHROME_PATH;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Initialize Telegram Bot
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD'];

// Handle /start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const opts = {
    reply_markup: {
      inline_keyboard: currencies.map(curr => [{
        text: curr,
        callback_data: `currency_${curr}`
      }])
    }
  };
  bot.sendMessage(chatId, 'Select a currency:', opts);
});

bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  if (data.startsWith('currency_')) {
    const currency = data.split('_')[1];
    const opts = {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'High Impact', callback_data: `impact_high_${currency}` }],
          [{ text: 'Medium Impact', callback_data: `impact_medium_${currency}` }]
        ]
      }
    };
    bot.sendMessage(chatId, `Selected ${currency}. Now choose impact level:`, opts);
  } else if (data.startsWith('impact_')) {
    const [, impact, currency] = data.split('_');
    const impactLevel = impact === 'high' ? 'High Impact Expected' : 'Medium Impact Expected';
    
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
    
    bot.sendMessage(chatId, `Selected ${currency} ${impactLevel}. Choose time period:`, opts);
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
    await sendForexData(chatId, impactLevel, currency, periodQuery);
  }
});

async function sendForexData(chatId, impactLevel, selectedCurrency, periodQuery = '') {
  try {
    const loadingMsg = await bot.sendMessage(chatId, `Fetching ${impactLevel} ${selectedCurrency} events...`);
    const forexData = await getForexFactoryData(impactLevel, selectedCurrency, periodQuery);

    let response = `📅 *${forexData.week}*\n`;
    response += `${selectedCurrency} ${impactLevel} Events: ${forexData.count}\n\n`;

    if (forexData.events.length === 0) {
      response += `No events found for the selected criteria.`;
    } else {
      forexData.events.forEach(event => {
        response += `⏰ *${event.time}* (${event.currency})\n`;
        response += `📌 ${event.event}\n`;
        response += `🔢 Actual: ${event.actual} | Forecast: ${event.forecast} | Previous: ${event.previous}\n\n`;
      });
    }

    await bot.editMessageText(response, {
      chat_id: chatId,
      message_id: loadingMsg.message_id,
      parse_mode: 'Markdown'
    });

  } catch (error) {
    bot.sendMessage(chatId, `Error fetching data: ${error.message}`);
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

app.get('/scrape', async (req, res) => {
  try {
    const data = await getForexFactoryData();
    res.json(data);
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Telegram bot is listening for commands...`);
});