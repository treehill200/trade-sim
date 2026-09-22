import { beforeEach, describe, expect, it } from 'vitest';
import { useAlerts } from '@/state/alertsStore';

/** Start every test from an empty list, whatever the previous one left. */
function reset(): void {
  useAlerts.setState({ alerts: [] });
}

function ids(): string[] {
  return useAlerts.getState().alerts.map((a) => a.id);
}

describe('price alerts', () => {
  beforeEach(reset);

  it('adds an alert armed, with the price rounded to whole cents', () => {
    useAlerts.getState().add(1234.6, 'above');
    const alert = useAlerts.getState().alerts[0];
    expect(alert?.priceCents).toBe(1235);
    expect(alert?.armed).toBe(true);
    expect(alert?.triggeredAt).toBeUndefined();
  });

  it('fires an above alert when the high reaches it', () => {
    useAlerts.getState().add(5000, 'above');
    const fired = useAlerts.getState().check(4900, 5000, 111);
    expect(fired).toHaveLength(1);
    expect(useAlerts.getState().alerts[0]?.armed).toBe(false);
    expect(useAlerts.getState().alerts[0]?.triggeredAt).toBe(111);
  });

  it('fires a below alert when the low reaches it', () => {
    useAlerts.getState().add(5000, 'below');
    expect(useAlerts.getState().check(5001, 5200, 1)).toHaveLength(0);
    expect(useAlerts.getState().check(4999, 5100, 2)).toHaveLength(1);
  });

  it('does not fire an above alert on a move that stays below it', () => {
    useAlerts.getState().add(5000, 'above');
    expect(useAlerts.getState().check(4000, 4999, 1)).toHaveLength(0);
    expect(useAlerts.getState().alerts[0]?.armed).toBe(true);
  });

  it('catches a price that gapped straight through the level', () => {
    useAlerts.getState().add(5000, 'above');
    // A single tick whose range spans the level still counts as a crossing.
    expect(useAlerts.getState().check(4000, 6000, 1)).toHaveLength(1);
  });

  it('is one-shot: a second crossing does not fire it again', () => {
    useAlerts.getState().add(5000, 'above');
    expect(useAlerts.getState().check(4900, 5100, 1)).toHaveLength(1);
    expect(useAlerts.getState().check(4900, 5100, 2)).toHaveLength(0);
  });

  it('re-arms a fired alert and forgets when it fired', () => {
    useAlerts.getState().add(5000, 'above');
    useAlerts.getState().check(4900, 5100, 1);
    const id = ids()[0] as string;
    useAlerts.getState().rearm(id);
    const alert = useAlerts.getState().alerts[0];
    expect(alert?.armed).toBe(true);
    expect(alert?.triggeredAt).toBeUndefined();
    expect(useAlerts.getState().check(4900, 5100, 2)).toHaveLength(1);
  });

  it('fires every armed alert a single move crosses', () => {
    useAlerts.getState().add(5000, 'above');
    useAlerts.getState().add(5100, 'above');
    useAlerts.getState().add(4000, 'below');
    expect(useAlerts.getState().check(4900, 5200, 1)).toHaveLength(2);
  });

  it('moves an alert to a new price but refuses a nonsense one', () => {
    useAlerts.getState().add(5000, 'above');
    const id = ids()[0] as string;
    useAlerts.getState().setPrice(id, 6000.4);
    expect(useAlerts.getState().alerts[0]?.priceCents).toBe(6000);
    useAlerts.getState().setPrice(id, 0);
    useAlerts.getState().setPrice(id, Number.NaN);
    expect(useAlerts.getState().alerts[0]?.priceCents).toBe(6000);
  });

  it('removes one alert and clears only the fired ones', () => {
    useAlerts.getState().add(5000, 'above');
    useAlerts.getState().add(6000, 'above');
    useAlerts.getState().add(7000, 'above');
    useAlerts.getState().check(4900, 5100, 1); // fires the 5000 only
    const [first] = ids();
    useAlerts.getState().remove(ids()[2] as string);
    expect(ids()).toHaveLength(2);
    useAlerts.getState().clearTriggered();
    expect(ids()).toHaveLength(1);
    expect(ids()[0]).not.toBe(first);
  });

  it('gives every alert a distinct id', () => {
    for (let i = 0; i < 20; i += 1) useAlerts.getState().add(5000 + i, 'above');
    expect(new Set(ids()).size).toBe(20);
  });
});
