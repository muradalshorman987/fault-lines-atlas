import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { emit } from '../src/app/events';
import { atlas } from '../src/app/store';
import { DbContext } from '../src/app/useT';
import { build } from '../src/data/build';
import type { DB } from '../src/data/types';
import '../src/i18n/core';
import { readRaw } from './helpers/readRaw';

// A dossier that crashes while rendering, as a malformed record could.
vi.mock('../src/features/dossier', () => ({ Dossier: () => { throw new Error('bad record'); } }));
// jsdom has no canvas: keep the map out of this page-level test.
vi.mock('../src/features/map', () => ({ MapStage: () => <div id="map" /> }));
// Stand-ins for the lazily loaded areas other workers build, so the tests see when their code has arrived.
vi.mock('../src/features/ask', () => ({ AskPanel: () => <div id="ask" hidden data-testid="ask-panel" /> }));
vi.mock('../src/features/welcome', async () => {
  const { useEffect, useState } = await import('react');
  const { on } = await import('../src/app/events');
  return {
    Welcome() {
      const [opened, setOpened] = useState(0);
      useEffect(() => on('welcome', () => setOpened((n) => n + 1)), []);
      return <div data-testid="welcome" data-opened={opened} />;
    },
  };
});

let db: DB;
beforeAll(() => { db = build(readRaw()); });
afterEach(() => { atlas.reset(); vi.restoreAllMocks(); });

const page = async () => {
  const { Layout } = await import('../src/features/layout/Layout');
  return render(<DbContext.Provider value={db}><Layout /></DbContext.Provider>);
};

// Must stay the first test: the lazy areas are cold only until something in this file has rendered them once.
test('lazy areas keep their empty containers until their code arrives; events sent meanwhile are not lost', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await page();
  expect(document.getElementById('tour')).toHaveAttribute('hidden');
  expect(document.querySelector('#tour .tour-card')).toBeNull(); // the fallback container, not the player yet
  expect(document.getElementById('ask')).toHaveAttribute('hidden');
  expect(screen.queryByTestId('ask-panel')).toBeNull();
  expect(screen.queryByTestId('welcome')).toBeNull();
  // What Boot does for a #tour-energy link right after the first commit, and the help dialog's "Start here".
  act(() => { emit('starttour', 'energy'); emit('welcome', null); });
  await waitFor(() => expect(atlas.get().tour).toEqual({ id: 'energy', step: 0 }));
  expect(document.querySelector('#tour .tour-card')).not.toBeNull();
  expect(document.getElementById('tour')).not.toHaveAttribute('hidden');
  expect(screen.getByTestId('ask-panel')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId('welcome')).toHaveAttribute('data-opened', '1'));
  expect(document.querySelectorAll('#tour')).toHaveLength(1);
  expect(document.querySelectorAll('#ask')).toHaveLength(1);
});

test('one area crashing leaves the rest of the page on screen', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await page();
  expect(document.querySelector('#topbar [data-k="search"]')).not.toBeNull();
  expect(document.querySelectorAll('#lensrail button').length).toBeGreaterThan(0);
  expect(document.getElementById('dossier')).toHaveAttribute('hidden');
});
