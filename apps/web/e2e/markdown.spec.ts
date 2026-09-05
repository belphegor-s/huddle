import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { SERVER_LOG } from './server-log';

/**
 * Markdown, in the two places it has to agree: the paint behind the caret
 * while it is typed, and the message once it is sent.
 *
 * The alignment check is the important one. The composer is a plain textarea
 * with a styled copy of the same characters behind it, so any style that
 * changes how wide a glyph is moves the paint out from under the caret. That
 * is invisible in a screenshot and obvious to anyone typing, so it is measured
 * rather than looked at.
 */
async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/signin');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a link' }).click();
  await expect(page.getByText('Check your email')).toBeVisible();

  for (let attempt = 0; attempt < 40; attempt++) {
    const lines = readFileSync(SERVER_LOG, 'utf8')
      .split('\n')
      .filter((line) => line.includes('email_not_sent') && line.includes(email));

    const last = lines.at(-1);
    if (last !== undefined) {
      const parsed = JSON.parse(last.slice(last.indexOf('{'))) as { text: string };
      const found = /https?:\/\/\S+/.exec(parsed.text)?.[0];
      if (found) {
        await page.goto(found);
        return;
      }
    }

    await page.waitForTimeout(250);
  }

  throw new Error('No sign in link was written');
}

async function openChannel(page: Page, prefix: string): Promise<void> {
  const slug = `${prefix}${Date.now().toString(36)}`;
  await signIn(page, `${slug}@example.com`);

  await page.getByLabel('Team name').fill('Markdown');
  await page.getByLabel('Address').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}$`));

  await page.getByRole('button', { name: 'New channel' }).click();
  await page.getByLabel('Name').fill('general');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/c\/general$/);
}

/**
 * The width of the painted layer's text as it is styled, and the width of the
 * same characters with every style taken off. A style that measures differently
 * shows up here as a gap.
 */
async function paintDrift(page: Page): Promise<number> {
  return page.evaluate(() => {
    const field = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]');
    const layer = field?.parentElement?.querySelector<HTMLElement>('[aria-hidden]');
    if (!field || !layer) throw new Error('The painted layer was not found');

    // The layer paints the field's own characters. If this ever stops holding,
    // the measurement below is comparing something else and means nothing.
    if (layer.textContent !== field.value) {
      throw new Error(`Painted ${JSON.stringify(layer.textContent)}, field ${field.value}`);
    }

    const measure = (element: HTMLElement): number => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getBoundingClientRect().width;
    };

    const bare = layer.cloneNode(true) as HTMLElement;
    for (const span of bare.querySelectorAll('span')) {
      span.removeAttribute('class');
      span.removeAttribute('style');
    }
    bare.style.position = 'absolute';
    bare.style.visibility = 'hidden';
    bare.style.width = `${String(layer.clientWidth)}px`;
    layer.parentElement?.append(bare);

    const drift = Math.abs(measure(layer) - measure(bare));
    bare.remove();
    return drift;
  });
}

test('the paint stays under the caret whatever markdown is typed', async ({ page }) => {
  await openChannel(page, 'md');

  const composer = page.getByLabel('Message', { exact: true });

  // One line, no wrapping, every mark the composer paints.
  await composer.fill('**bold** _italic_ ~~gone~~ `code` @ada https://example.com/x');
  await page.waitForTimeout(100);

  const styled = await paintDrift(page);
  expect(styled, 'the styled paint is a different width from the plain text').toBeLessThan(1);

  /*
   * The measurement, checked against a fault put there on purpose. A width
   * comparison that never fails proves nothing, and this one would pass just
   * as happily if the clone were measured twice.
   */
  await page.evaluate(() => {
    const field = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]');
    const layer = field?.parentElement?.querySelector<HTMLElement>('[aria-hidden]');
    layer?.querySelector('span')?.setAttribute('style', 'font-family: monospace');
  });
  expect(await paintDrift(page), 'the measurement cannot see a font change').toBeGreaterThan(1);
});

test('a fenced block is coloured while it is typed and after it is sent', async ({ page }) => {
  await openChannel(page, 'fence');

  const composer = page.getByLabel('Message', { exact: true });
  await composer.click();

  // Typed, not filled: Enter inside an open fence has to make a line rather
  // than send, which is the whole reason a code block is possible here.
  await page.keyboard.type('```ts');
  await page.keyboard.press('Enter');
  await page.keyboard.type('const answer = 42; // note');
  await page.keyboard.press('Enter');
  await page.keyboard.type('```');

  await expect(composer).toHaveValue('```ts\nconst answer = 42; // note\n```');

  const painted = page
    .locator('textarea[aria-label="Message"]')
    .locator('..')
    .locator('[aria-hidden]');
  await expect(painted.locator('span.text-syntax-keyword')).toHaveCount(1);
  await expect(painted.locator('span.text-syntax-comment')).toHaveCount(1);

  await page.getByRole('button', { name: 'Send' }).click();

  const sent = page.getByRole('list', { name: 'Messages' }).locator('pre').last();
  await expect(sent).toContainText('const answer = 42;');
  await expect(sent.locator('span.text-syntax-keyword')).toHaveCount(1);
  await expect(sent.locator('span.text-syntax-number')).toHaveCount(1);
});

test('Enter continues a list and an empty item ends it', async ({ page }) => {
  await openChannel(page, 'list');

  const composer = page.getByLabel('Message', { exact: true });
  await composer.click();

  await page.keyboard.type('- one');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('two');
  await page.keyboard.press('Shift+Enter');
  await expect(composer).toHaveValue('- one\n- two\n- ');

  // A second Enter on the empty item takes the marker away again.
  await page.keyboard.press('Shift+Enter');
  await expect(composer).toHaveValue('- one\n- two\n');
});

test('a heading renders as a heading', async ({ page }) => {
  await openChannel(page, 'head');

  await page.getByLabel('Message', { exact: true }).fill('## Release notes');
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(
    page.getByRole('list', { name: 'Messages' }).getByRole('heading', { name: 'Release notes' }),
  ).toBeVisible();
});

test('a message with a code block can be edited without sending on Enter', async ({ page }) => {
  await openChannel(page, 'edit');

  const composer = page.getByLabel('Message', { exact: true });
  await composer.fill('```js\nconst a = 1;\n```');
  await page.getByRole('button', { name: 'Send' }).click();

  const row = page.getByRole('list', { name: 'Messages' }).getByRole('listitem').last();
  await row.hover();
  await row.getByRole('button', { name: 'Edit message' }).click();

  // By tag, because the row's edit button carries the same label.
  const editor = page.locator('textarea[aria-label="Edit message"]');
  await expect(editor).toHaveValue('```js\nconst a = 1;\n```');

  // The caret lands at the end, outside the block, so this puts it back in.
  await editor.press('ArrowUp');
  await editor.press('End');
  await editor.press('Enter');
  await editor.pressSequentially('const b = 2;');
  await expect(editor).toHaveValue('```js\nconst a = 1;\nconst b = 2;\n```');

  // Outside the block Enter saves, which is what it has always done.
  await editor.press('ArrowDown');
  await editor.press('End');
  await editor.press('Enter');

  await expect(editor).toBeHidden();
  await expect(row.locator('pre')).toContainText('const b = 2;');
});
