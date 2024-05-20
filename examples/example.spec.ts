import { stagehandFixture } from '../lib/playwright/fixture';
import { expect } from '@playwright/test';

stagehandFixture.only('has title', async ({ stagePage }) => {
  await stagePage.page.goto('https://browserbase.com');

  const observation = await stagePage.observe('find a way to get early access');
  await stagePage.act({
    observation,
    action: 'visit early access page',
  });

  stagePage.setPage(
    stagePage.context.pages()[stagePage.context.pages().length - 1]
  );

  await stagePage.act({
    action: 'fill in the form with random valid information and submit',
  });
});

stagehandFixture(
  'book the next available timeslot',
  async ({ page, stagePage: { observe, act } }) => {
    await page.goto('https://calendly.com/zerostep-test/test-calendly');

    const calendar = await observe('find the calendar');
    await act({ action: 'dismiss the privacy modal' });
    await act({
      action: 'Click on the first available day of the month ',
      observation: calendar,
    });

    const times = await observe('find the list of available times');

    await act({
      action: 'book the earliest provided time',
      observation: times,
    });

    await act({
      action: 'proceed with booking the appointment',
      observation: times,
    });

    await act({
      action: 'Fill out the form with realistic values',
    });

    await act({
      action: 'Submit the form',
    });

    const element = await page.getByText('You are scheduled');
    expect(element).toBeDefined();
  }
);

stagehandFixture(
  'view article history and verify earliest revision',
  async ({ page, stagePage: { observe, act } }) => {
    await page.goto('https://en.wikipedia.org/wiki/Software_testing');
    const link = await observe('find the view history link');
    await act({
      action: `Click on "View history" link`,
      observation: link,
    });

    const list = await observe('find the list of revisions');
    await act({ action: 'Sort by "oldest"', observation: list });

    await page.waitForURL(
      'https://en.wikipedia.org/w/index.php?title=Software_testing&action=history&dir=prev'
    );
  }
);
