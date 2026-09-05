import { Icon, Menu, MenuButton, MenuItem, MenuLabel, MenuSeparator, Spinner } from '@huddle/ui';
import { useEffect, useState } from 'react';
import type { CallSession, CallStats, CallView } from '../lib/call';

/** How the tiles are arranged, chosen rather than guessed at. */
export type CallLayout = 'auto' | 'grid' | 'spotlight';

export const LAYOUTS: { value: CallLayout; label: string; hint: string }[] = [
  { value: 'auto', label: 'Automatic', hint: 'A screen takes the stage' },
  { value: 'grid', label: 'Grid', hint: 'Everyone the same size' },
  { value: 'spotlight', label: 'Spotlight', hint: 'One large, the rest beside' },
];

interface CallSettingsProps {
  session: CallSession;
  call: CallView;
  layout: CallLayout;
  onLayout(layout: CallLayout): void;
}

/**
 * The things a call needs that do not deserve a button of their own.
 *
 * Everything here is read from the browser rather than remembered: the list of
 * microphones changes when somebody plugs one in, and a panel that shows what
 * was true when the call started is worse than no panel.
 */
export function CallSettings({ session, call, layout, onLayout }: CallSettingsProps) {
  return (
    <Menu
      label="Huddle settings"
      align="end"
      side="top"
      className="w-72"
      trigger={
        <MenuButton
          aria-label="Huddle settings"
          title="Settings"
          className="grid size-11 shrink-0 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        >
          <Icon name="more" className="size-5" />
        </MenuButton>
      }
    >
      <>
        <MenuLabel>Layout</MenuLabel>
        {LAYOUTS.map((option) => (
          <MenuItem
            key={option.value}
            selected={layout === option.value}
            hint={option.hint}
            keepOpen
            onSelect={() => onLayout(option.value)}
          >
            {option.label}
          </MenuItem>
        ))}

        <MenuSeparator />
        <MenuLabel>Microphone</MenuLabel>
        <DeviceList
          devices={call.devices.microphones}
          current={call.devices.microphoneId}
          empty="No microphone found"
          onPick={(id) => void session.useDevice('audio', id)}
        />

        <MenuSeparator />
        <MenuLabel>Camera</MenuLabel>
        <DeviceList
          devices={call.devices.cameras}
          current={call.devices.cameraId}
          empty="No camera found"
          onPick={(id) => void session.useDevice('video', id)}
        />

        <MenuSeparator />
        <Statistics session={session} />
      </>
    </Menu>
  );
}

function DeviceList({
  devices,
  current,
  empty,
  onPick,
}: {
  devices: MediaDeviceInfo[];
  current: string | null;
  empty: string;
  onPick(deviceId: string): void;
}) {
  if (devices.length === 0) {
    return <p className="text-text-muted px-2.5 py-1.5 text-xs">{empty}</p>;
  }

  return (
    <>
      {devices.map((device, index) => (
        <MenuItem
          key={device.deviceId}
          selected={device.deviceId === current}
          keepOpen
          onSelect={() => onPick(device.deviceId)}
        >
          {/* Blank until permission is granted, which is a browser rule. */}
          {device.label || `Input ${String(index + 1)}`}
        </MenuItem>
      ))}
    </>
  );
}

/**
 * What the connection is doing.
 *
 * Read when the panel opens rather than polled, because nobody needs this
 * until they are asking why a call sounds bad.
 */
function Statistics({ session }: { session: CallSession }) {
  const [stats, setStats] = useState<CallStats | null>(null);

  useEffect(() => {
    let live = true;

    const read = () => {
      void session.readStats().then((next) => {
        if (live) setStats(next);
      });
    };

    read();
    const timer = setInterval(read, 2000);

    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [session]);

  if (!stats) {
    return (
      <p className="text-text-muted flex items-center gap-2 px-2.5 py-1.5 text-xs">
        <Spinner className="size-3" />
        Reading the connection
      </p>
    );
  }

  return (
    <>
      <MenuLabel>Connection</MenuLabel>
      <dl className="grid grid-cols-3 gap-1 px-2.5 pt-1 pb-2 text-center">
        <Stat
          label="Delay"
          value={stats.latencyMs === null ? null : `${String(stats.latencyMs)}ms`}
        />
        <Stat
          label="Lost"
          value={stats.lossPercent === null ? null : `${String(stats.lossPercent)}%`}
        />
        <Stat
          label="In"
          value={stats.inboundKbps === null ? null : `${String(stats.inboundKbps)}kb`}
        />
      </dl>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="border-border bg-surface rounded-lg border py-1.5">
      <dt className="text-text-muted text-2xs">{label}</dt>
      <dd className="font-mono text-xs tabular-nums">{value ?? '--'}</dd>
    </div>
  );
}
