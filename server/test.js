const express = require('express');
const puppeteer = require('puppeteer-core');
const app = express();
const port = 3000;

app.use(express.json());

// Endpoint to send text and get AI response
app.post('/chat', async (req, res) => {
  try {
    console.log('Received request:', req.body); // Log incoming request
    const { text } = req.body;
    
    if (!text) {
      console.log('No text provided');
      return res.status(400).json({ error: 'Text is required' });
    }

    const response = await getAIResponse(text);
    console.log('Successfully got response:', response);
    res.json({ response });
  } catch (error) {
    console.error('Full error:', error); // Log complete error
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message // Include error details
    });
  }
});


async function getAIResponse(inputText) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  
  try {
    // Navigate to the chat page
    await page.goto('https://monica.im/home/chat/DeepSeek%20V3/deepseek_chat', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Wait for the chat input to be available
    await page.waitForSelector('textarea[data-input_node="monica-chat-input"]', {
      visible: true,
      timeout: 10000
    });

    // Type the input text
    await page.type('textarea[data-input_node="monica-chat-input"]', inputText);

    // Click the send button
    await page.click('.input-msg-btn--cT5PX');

    // Wait for the response - this selector might need adjustment based on actual page structure
    await page.waitForSelector('.bot-response', { timeout: 30000 });

    // Get the response text
    const response = await page.evaluate(() => {
      const responseElements = document.querySelectorAll('.bot-response');
      return responseElements[responseElements.length - 1].innerText;
    });

    return response;
  } catch (error) {
    console.error('Error during scraping:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
