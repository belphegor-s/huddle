import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { SERVER_LOG } from './server-log';

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

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

test('a public channel is visible to a member who has not joined it', async ({ browser }) => {
  const slug = unique('open');

  const owner = await browser.newContext();
  const ownerPage = await owner.newPage();
  await signIn(ownerPage, `owner-${slug}@example.com`);

  await ownerPage.getByLabel('Team name').fill('Open');
  await ownerPage.getByLabel('Address').fill(slug);
  await ownerPage.getByRole('button', { name: 'Create workspace' }).click();

  await ownerPage.getByRole('button', { name: 'New channel' }).click();
  await ownerPage.getByLabel('Name').fill('announcements');
  await ownerPage.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(ownerPage).toHaveURL(/\/c\/announcements$/);

  await ownerPage.goto(`/w/${slug}/people`);
  await ownerPage.getByRole('button', { name: 'New link' }).click();
  const invite = new URL((await ownerPage.locator('output').first().textContent()) ?? '').pathname;

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await signIn(guestPage, `guest-${slug}@example.com`);
  await guestPage.goto(invite);
  await guestPage.getByRole('button', { name: 'Join workspace' }).click();
  await expect(guestPage).toHaveURL(new RegExp(`/w/${slug}$`));

  // The channel is public and the guest is a member of the workspace, so it
  // has to be reachable. It used to be invisible to anybody not added to it
  // by hand, which made a workspace of open channels look empty.
  const nav = guestPage.getByRole('navigation');
  await expect(nav.getByRole('link', { name: /announcements/ })).toBeVisible();

  await nav.getByRole('link', { name: /announcements/ }).click();
  await expect(guestPage).toHaveURL(/\/c\/announcements$/);

  await guest.close();
  await owner.close();
});

test('status, presence and settings are reachable from the sidebar', async ({ page }) => {
  const slug = unique('status');
  await signIn(page, `${slug}@example.com`);

  await page.getByLabel('Team name').fill('Statuses');
  await page.getByLabel('Address').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}$`));

  // The menu renders in the top layer, so it has to paint above the sidebar
  // whatever stacking contexts exist between them.
  await page
    .getByRole('button', { name: /Sign out|Active/ })
    .first()
    .click();
  const menu = page.getByRole('menu', { name: 'Your status' });
  await expect(menu).toBeVisible();

  const above = await menu.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const at = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return element.contains(at);
  });
  expect(above).toBe(true);

  await menu.getByRole('menuitem', { name: 'Do not disturb' }).click();
  await expect(menu).toBeHidden();

  // The choice survives a reload, which is the only proof it was stored.
  await page.reload();
  await expect(page.getByRole('img', { name: 'Do not disturb' })).toBeVisible();

  // Workspace settings had no way in at all before.
  await page.getByRole('button', { name: 'Statuses' }).first().click();
  await page.getByRole('menuitem', { name: 'Workspace settings' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/settings$`));

  const name = page.getByLabel('Name');
  await name.fill('Renamed');
  await name.press('Enter');
  await expect(page.getByText('Saved')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Renamed' }).first()).toBeVisible();
});

test('a profile saves on Enter', async ({ page }) => {
  const slug = unique('profile');
  await signIn(page, `${slug}@example.com`);

  await page.getByLabel('Team name').fill('Profiles');
  await page.getByLabel('Address').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  // Creating has to have landed before navigating, or the next page load races
  // the membership and the workspace reads as one this person is not in.
  await expect(page).toHaveURL(new RegExp(`/w/${slug}$`));

  await page.goto(`/w/${slug}/you`);
  const field = page.getByLabel('Display name');
  await field.fill('Ada Lovelace');
  await field.press('Enter');

  await expect(page.getByText('Saved')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Display name')).toHaveValue('Ada Lovelace');
});

test('the sidebar narrows to a rail and stays that way', async ({ page }) => {
  const slug = unique('rail');
  await signIn(page, `${slug}@example.com`);

  await page.getByLabel('Team name').fill('Rails');
  await page.getByLabel('Address').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}$`));

  await page.getByRole('button', { name: 'New channel' }).click();
  await page.getByLabel('Name').fill('general');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/c\/general$/);

  const sidebar = page.getByRole('navigation');
  const wide = (await sidebar.boundingBox())?.width ?? 0;
  expect(wide).toBeGreaterThan(200);

  // The control says what it does, on hover and on focus. A title attribute
  // never appears for anybody arriving by keyboard.
  await page.getByRole('button', { name: 'Narrow the sidebar' }).hover();
  const tip = page.getByRole('tooltip', { includeHidden: false }).first();
  await expect(tip).toBeVisible({ timeout: 5_000 });
  await expect(tip).toHaveText('Narrow the sidebar');

  /*
   * In the top layer, so a sidebar's overflow cannot clip it. Asserted by the
   * popover state rather than by hit testing: a tooltip takes no pointer
   * events, so it is deliberately invisible to elementFromPoint.
   */
  const layered = await tip.evaluate((element) => ({
    inTopLayer: element.matches(':popover-open'),
    insideWindow:
      element.getBoundingClientRect().right <= window.innerWidth &&
      element.getBoundingClientRect().left >= 0,
    ignoresPointer: getComputedStyle(element).pointerEvents === 'none',
  }));

  expect(layered).toEqual({ inTopLayer: true, insideWindow: true, ignoresPointer: true });

  await page.getByRole('button', { name: 'Narrow the sidebar' }).click();
  await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeLessThan(wide / 2);

  // The channel is still reachable, which is the point of a rail rather than
  // a hidden sidebar.
  await expect(sidebar.getByRole('link', { name: /general/ })).toBeVisible();

  // And it is remembered, or it would have to be narrowed on every visit.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Widen the sidebar' })).toBeVisible();
  // Polled: the width is animated, so reading it once catches it mid flight.
  await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeLessThan(wide / 2);

  await page.getByRole('button', { name: 'Widen the sidebar' }).click();
  await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeGreaterThan(200);
});

test('the sidebar menus line up with the sidebar', async ({ page }) => {
  const slug = unique('align');
  await signIn(page, `${slug}@example.com`);

  await page.getByLabel('Team name').fill('Aligned');
  await page.getByLabel('Address').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}$`));

  const sidebar = page.getByRole('navigation');
  const rows = await sidebar.evaluate((nav) => {
    const style = getComputedStyle(nav);
    const box = nav.getBoundingClientRect();
    return {
      left: box.left + Number.parseFloat(style.paddingLeft),
      width:
        box.width - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight),
    };
  });

  for (const [control, name] of [
    ['Aligned', 'Workspaces'],
    [/Active/, 'Your status'],
  ] as const) {
    await page.getByRole('button', { name: control }).first().click();

    const panel = page.getByRole('menu', { name });
    await expect(panel).toBeVisible();

    // Within a pixel: layout is sub pixel, and a whole pixel is the point
    // at which somebody would actually see the edges disagree.
    const box = await panel.boundingBox();
    expect(
      Math.abs((box?.width ?? 0) - rows.width),
      `${name} is not the width of a sidebar row`,
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs((box?.x ?? 0) - rows.left),
      `${name} does not start where a sidebar row does`,
    ).toBeLessThanOrEqual(1);

    await page.keyboard.press('Escape');
  }
});

test('a menu closes on the click that opened it', async ({ page }) => {
  const slug = unique('toggle');
  await signIn(page, `${slug}@example.com`);

  await page.getByLabel('Team name').fill('Toggles');
  await page.getByLabel('Address').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}$`));

  /*
   * Pressing the trigger again used to reopen it. Light dismiss closes a
   * popover on the way down of the click, so the click that followed found a
   * closed menu and opened it, and the menu looked stuck.
   */
  for (const [control, name] of [
    ['Toggles', 'Workspaces'],
    [/Active/, 'Your status'],
  ] as const) {
    const trigger = page.getByRole('button', { name: control }).first();
    const panel = page.getByRole('menu', { name });

    /*
     * The trigger hands the toggling to the browser. Asserted directly,
     * because the ordering that breaks it, light dismiss landing between
     * pointerup and click, is the browser's own and a synthetic click does
     * not always reproduce it. What can be checked here is that nothing on
     * this side is toggling a popover the platform is already toggling.
     */
    const controls = (await trigger.getAttribute('aria-controls')) ?? '';
    expect(controls).not.toBe('');
    await expect(trigger).toHaveAttribute('popovertarget', controls);

    await trigger.click();
    await expect(panel).toBeVisible();

    await trigger.click();
    await expect(panel, `${name} did not close on a second press`).toBeHidden();

    // And it still opens afterwards, rather than needing two presses from now on.
    await trigger.click();
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  }
});

test('the workspace chevron sits at the end of its row on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  const slug = unique('chev');
  await signIn(page, `${slug}@example.com`);

  await page.getByLabel('Team name').fill('Chevrons');
  await page.getByLabel('Address').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}$`));

  // The collapse control only exists from md up, so the padding that made room
  // for it left the chevron floating a button's width in from the edge.
  const gap = await page
    .getByRole('button', { name: 'Chevrons' })
    .first()
    .evaluate((button) => {
      const icon = button.querySelector('svg:last-of-type');
      if (!icon) throw new Error('no chevron');
      return button.getBoundingClientRect().right - icon.getBoundingClientRect().right;
    });

  // The row's own padding, and nothing more.
  expect(gap).toBeLessThanOrEqual(10);
});

test('the rail marks the channel you are in with a ring, not a block', async ({ page }) => {
  const slug = unique('ring');
  await signIn(page, `${slug}@example.com`);

  await page.getByLabel('Team name').fill('Rings');
  await page.getByLabel('Address').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}$`));

  for (const name of ['general', 'design']) {
    await page.getByRole('button', { name: 'New channel' }).click();
    await page.getByLabel('Name').fill(name);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/c/${name}$`));
  }

  const sidebar = page.getByRole('navigation');
  const row = sidebar.getByRole('link', { name: /design/ });

  await page.getByRole('button', { name: 'Narrow the sidebar' }).click();
  await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeLessThan(120);

  /*
   * Filled, the selected row was a block the width of the whole rail, which
   * reads as the row having grown rather than as the one you are in. The mark
   * is the only thing in there with a shape, so the ring goes on the mark.
   */
  const drawn = await row.evaluate((link) => {
    const mark = link.querySelector('span[aria-hidden]');
    return {
      rowFilled: getComputedStyle(link).backgroundColor,
      markRing: mark === null ? '' : getComputedStyle(mark).outlineWidth,
      markShadow: mark === null ? '' : getComputedStyle(mark).boxShadow,
    };
  });

  expect(drawn.rowFilled, 'the selected row is still a filled block').toBe('rgba(0, 0, 0, 0)');
  // Tailwind draws a ring as a box shadow, so that is where it shows up.
  expect(drawn.markShadow, 'the selected mark has no ring').not.toBe('none');

  // The one not selected has no ring at all, or the ring says nothing.
  const other = await sidebar.getByRole('link', { name: /general/ }).evaluate((link) => {
    const mark = link.querySelector('span[aria-hidden]');
    return mark === null ? '' : getComputedStyle(mark).boxShadow;
  });

  expect(other).toBe('none');
});

test('the lock says what it means, on a phone as well', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  const slug = unique('lock');
  await signIn(page, `${slug}@example.com`);

  await page.getByLabel('Team name').fill('Locks');
  await page.getByLabel('Address').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}$`));

  await page.getByRole('button', { name: 'New channel' }).click();
  await page.getByLabel('Name').fill('general');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/c\/general$/);

  /*
   * Pressed rather than hovered. A hover tooltip is nothing at all on a phone,
   * and this is the one badge in the app that makes a promise worth reading.
   */
  const lock = page.getByRole('button', { name: 'End to end encrypted' });
  await lock.click();

  const note = page.getByRole('dialog', { name: 'End to end encrypted' });
  await expect(note).toBeVisible();
  await expect(note).toContainText('never holds the key');

  // It fits the phone it is on.
  const box = await note.boundingBox();
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);

  await lock.click();
  await expect(note).toBeHidden();
});

test('the workspace address can be copied in one press', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  const slug = unique('addr');
  await signIn(page, `${slug}@example.com`);

  await page.getByLabel('Team name').fill('Addresses');
  await page.getByLabel('Address').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}$`));

  await page.goto(`/w/${slug}/settings`);

  // By role: the copy control's own name has the word in it too.
  const field = page.getByRole('textbox', { name: 'Address' });
  await expect(field).toHaveValue(new RegExp(`/w/${slug}$`));

  // Readable rather than disabled: a disabled field cannot be focused, so the
  // text nobody can select is the one thing this row exists to hand over.
  await expect(field).not.toBeDisabled();

  await page.getByRole('button', { name: 'Copy the address' }).click();

  const taken = await page.evaluate(() => navigator.clipboard.readText());
  expect(taken).toBe(await field.inputValue());

  // It says so, rather than leaving somebody wondering whether it worked.
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
});

test('an invite link is copied the same way the address is', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  const slug = unique('inv');
  await signIn(page, `${slug}@example.com`);

  await page.getByLabel('Team name').fill('Invites');
  await page.getByLabel('Address').fill(slug);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}$`));

  await page.goto(`/w/${slug}/people`);
  await page.getByRole('button', { name: 'New link' }).click();

  const link = page.locator('output').first();
  await expect(link).toBeVisible();

  /*
   * One control, one shape, everywhere something is handed over. This was a
   * button beside the value wearing the word Copy while the address was an
   * icon inside the field, which is two answers to the same question.
   */
  const copy = page.getByRole('button', { name: 'Copy the invite link' });
  const inside = await copy.evaluate((button) => {
    const box = button.getBoundingClientRect();
    const field = button.parentElement?.getBoundingClientRect();
    return field === undefined ? false : box.right <= field.right + 1 && box.left >= field.left - 1;
  });

  expect(inside, 'the copy control is not inside the field it belongs to').toBe(true);

  await copy.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await link.textContent());
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
});
