const express = require('express');
const puppeteer = require('puppeteer-core');

const app = express();
const PORT = 3000;

const CHROME_PATH = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';

app.get('/scrape', async (req, res) => {
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

    await page.goto('https://www.forexfactory.com/calendar', { waitUntil: 'networkidle2' });
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

    // Filter for only high impact events
    const highImpactEvents = events.filter(event => event.impact === 'High Impact Expected');

    res.json({
      source: 'Forex Factory',
      week,
      count: highImpactEvents.length,
      events: highImpactEvents
    });

  } catch (err) {
    console.error('Puppeteer scrape error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

app.listen(PORT, () => {
  console.log(`Puppeteer-based scraper running at http://localhost:${PORT}/scrape`);
});
