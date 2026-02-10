import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

const TERM_ID = 'main';

export default function TerminalPane({ visible }) {
  const hostRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const spawnedRef = useRef(false);
  const cleanupRef = useRef(null);

  // Initialize xterm once and keep it mounted for fast toggles.
  useEffect(() => {
    if (termRef.current || !hostRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      theme: {
        background: '#161616',
        foreground: '#e5e5e7',
        cursor: '#0a84ff',
        cursorAccent: '#161616',
        selectionBackground: 'rgba(10, 132, 255, 0.35)',
        black: '#1e1e1e',
        brightBlack: '#3a3a3c',
        red: '#ff453a',
        brightRed: '#ff6961',
        green: '#30d158',
        brightGreen: '#4ae068',
        yellow: '#ff9f0a',
        brightYellow: '#ffc60a',
        blue: '#0a84ff',
        brightBlue: '#409cff',
        magenta: '#bf5af2',
        brightMagenta: '#da8fff',
        cyan: '#64d2ff',
        brightCyan: '#8ee4ff',
        white: '#e5e5e7',
        brightWhite: '#f5f5f7'
      },
      fontFamily: "'SF Mono', SFMono-Regular, ui-monospace, Menlo, monospace",
      fontSize: 12,
      letterSpacing: 0,
      scrollback: 3000
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    term.writeln('\x1b[90mTerminal ready. Open the pane to start a shell session.\x1b[0m');
    const offData = window.ngobs.terminal.onData(({ id, data }) => {
      if (id === TERM_ID) term.write(data);
    });
    const offExit = window.ngobs.terminal.onExit(({ id }) => {
      if (id === TERM_ID) {
        spawnedRef.current = false;
        term.writeln('\r\n[terminal exited]');
      }
    });
    const offError = window.ngobs.terminal.onError(({ id, message }) => {
      if (id === TERM_ID) {
        spawnedRef.current = false;
        term.writeln(`\r\n[terminal error] ${message}`);
      }
    });

    term.onData((data) => window.ngobs.terminal.write(TERM_ID, data));

    const ro = new ResizeObserver(() => {
      if (hostRef.current && hostRef.current.offsetHeight > 10 && fitRef.current) {
        fitRef.current.fit();
        if (spawnedRef.current) {
          window.ngobs.terminal.resize(TERM_ID, term.cols, term.rows);
        }
      }
    });
    ro.observe(hostRef.current);

    const focusTerminal = () => term.focus();
    hostRef.current.addEventListener('mousedown', focusTerminal);

    termRef.current = term;
    fitRef.current = fit;
    cleanupRef.current = () => {
      offData();
      offExit();
      offError();
      ro.disconnect();
      hostRef.current?.removeEventListener('mousedown', focusTerminal);
      window.ngobs.terminal.kill(TERM_ID);
      term.dispose();
    };
  }, []);

  // Spawn/focus terminal when pane becomes visible.
  useEffect(() => {
    if (!visible || !termRef.current || !fitRef.current) return;

    let cancelled = false;
    let attempts = 0;
    const start = async () => {
      if (cancelled) return;
      if (!hostRef.current || hostRef.current.offsetHeight <= 10) return;
      fitRef.current.fit();

      if (!spawnedRef.current) {
        const cols = Math.max(termRef.current.cols, 20);
        const rows = Math.max(termRef.current.rows, 5);
        const ok = await window.ngobs.terminal.create(TERM_ID, cols, rows);
        if (cancelled || !ok) return;
        spawnedRef.current = true;
      } else {
        window.ngobs.terminal.resize(TERM_ID, termRef.current.cols, termRef.current.rows);
      }

      termRef.current.focus();
    };

    const retryUntilReady = () => {
      if (cancelled) return;
      if (hostRef.current && hostRef.current.offsetHeight > 10) {
        start();
        return;
      }
      if (attempts < 24) {
        attempts += 1;
        setTimeout(retryUntilReady, 25);
      }
    };

    const frame = requestAnimationFrame(retryUntilReady);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [visible]);

  // Cleanup on unmount only
  useEffect(() => {
    return () => {
      if (cleanupRef.current) cleanupRef.current();
    };
  }, []);

  return <div className="terminal-pane" ref={hostRef} />;
}
