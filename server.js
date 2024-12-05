const express = require('express');
const Stagehand = require('./dist/index');

const app = express();
const PORT = 3000;

// Middleware to parse JSON requests
app.use(express.json());

app.post('/run-task-steps', async (req, res) => {
  const { taskId, steps } = req.body;

  if (!taskId || !steps || !Array.isArray(steps)) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  try {
    const stagehand = new Stagehand.Stagehand({
      env: 'LOCAL',
      verbose: 1,
      debugDom: true,
      domSettleTimeoutMs: 100,
    });

    await stagehand.init({ modelName: 'gpt-4o' });

    const stepStatuses = [];
    for (let step of steps) {
      console.log('Executing step:', step);
      // TODO: Add logic for it to understand by itself when to decide to check the URL and use page.goto (that too without https)
      const result = await stagehand.act("Go to google.com");
      stepStatuses.push({ step, success: result.success, message: result.message });
    }

    res.json({ taskId, stepStatuses });
  } catch (error) {
    console.error('Error importing Stagehand or executing task:', error);
    res.status(500).json({ error: 'Failed to execute task', details: error.message });
  }
});


app.get('/run-notepad-task', async (req, res)=>{
  try {
    const stagehand = new Stagehand.Stagehand({
      env: 'LOCAL',
      verbose: 1,
      debugDom: true,
      domSettleTimeoutMs: 100,
    });

    await stagehand.init({ modelName: 'gpt-4o' });
    await stagehand.page.goto("https://onlinenotepad.org/notepad");
    await stagehand.act({
      action: "find the content body of the page on notepad and enter %data%",
      variables: {
        data: "Hello, i am saving this data in the online notepad",
      },
    });

  } catch (error) {
    console.error('Error importing Stagehand or executing task:', error);
    res.status(500).json({ error: 'Failed to execute task', details: error.message });
  }
}

)
// Start the server
app.listen(PORT, () => {
  console.log(`Stagehand server listening on port ${PORT}`);
});
