'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function adapter(config = {}, DateClass = Date) {
    const timers = new Map();
    let next = 0;
    class Adapter {
        constructor() {
            this.config = { enabled: true, simulationEnabled: true, ...config };
            this.namespace = 'presence-control.0';
            this.writes = [];
            this.log = { info() {}, warn() {}, debug() {} };
        }
        on() {}
        setState() {}
        async setStateAsync() {}
        async setForeignStateAsync(id, value) { this.writes.push([id, value]); }
        setForeignState(id, value) { this.writes.push([id, value]); }
        async getForeignStateAsync(id) { return this.sources?.[id] || null; }
        async extendForeignObjectAsync(id, value) { this.migration = value; }
    }
    const context = {
        require: () => ({ Adapter }), module: { parent: true }, Date: DateClass, Math, console,
        setTimeout(fn, delay) { const id = ++next; timers.set(id, { fn, delay }); return id; },
        clearTimeout(id) { timers.delete(id); }
    };
    vm.runInNewContext(fs.readFileSync(require.resolve('../main.js'), 'utf8'), context);
    const instance = context.module.exports();
    instance.timers = timers;
    return instance;
}

test('legacy rules migrate to visible checkboxes; explicit empty selections stay disabled', async () => {
    const a = adapter({ actions: [{ trigger: 'away' }] });
    await a.migrateActions();
    assert.equal(a.config.actions[0].onaway, true);
    assert.equal(a.config.actions[0].onvacation, false);
    assert.ok(a.migration);
    assert.equal(a.actionMatchesMode({ onaway: true, onvacation: true }, 'vacation'), true);
    assert.equal(a.actionMatchesMode({ trigger: 'away', onaway: false }, 'away'), false);
});

test('returning home cancels a pending away transition', async () => {
    const a = adapter(); a.mode = 'home'; a.initialModeApplied = true;
    await a.requestMode('away', 100);
    await a.requestMode('home', 0);
    assert.equal(a.timers.size, 0);
});

test('invalid readings do not become zero; strict source mode does not fall back', async () => {
    const a = adapter({ lightSourceMode: 'brightness', brightnessId: 'lux', sunElevationId: 'sun' });
    a.sources = { sun: { val: -10 } };
    assert.equal(Number.isNaN(a.sensorNumber({ val: null })), true);
    assert.equal(Number.isNaN(a.sensorNumber({ val: '', q: 0 })), true);
    await a.evaluateLight();
    assert.equal(a.lightState, 'unknown');
});

test('sensor simulation fires once daily, waits for valid threshold and keeps off timer', async () => {
    const a = adapter({ simulationEntries: [{ enabled: true, targetId: 'lamp', triggerType: 'sun', threshold: -3, probability: 100, minDurationMin: 5 }] });
    a.mode = 'vacation';
    a.scheduleDailySimulation();
    await a.evaluateSensorSimulation(NaN, 1);
    assert.equal(a.writes.length, 0);
    await a.evaluateSensorSimulation(NaN, -4);
    await a.evaluateSensorSimulation(NaN, -5);
    assert.equal(a.writes.length, 1);
    assert.equal(a.simulationOffTimers.size, 1);
    a.scheduleDailySimulation();
    assert.equal(a.writes.length, 1);
    a.clearSimulationTimers();
    assert.equal(a.simulationOffTimers.size, 1);
    const off = a.timers.get([...a.simulationOffTimers][0]);
    off.fn();
    assert.equal(a.writes[1][1], false);
});

test('brightness above threshold, probability zero and stop are respected', async () => {
    const a = adapter({ simulationEntries: [{ enabled: true, targetId: 'button', kind: 'button', triggerType: 'brightness', comparison: 'above', threshold: 50, probability: 100 }] });
    a.mode = 'away'; a.scheduleDailySimulation();
    await a.evaluateSensorSimulation(49, NaN);
    assert.equal(a.writes.length, 0);
    await a.evaluateSensorSimulation(50, NaN);
    assert.equal(a.writes.length, 1);
    a.simulationStopped = true; a.clearSimulationTimers(); a.scheduleDailySimulation();
    assert.equal(a.simulationTimers.size, 0);
    a.simulationStopped = false; a.config.simulationEntries[0].probability = 0;
    a.simulationPlans.clear();
    a.scheduleDailySimulation(); await a.evaluateSensorSimulation(80, NaN);
    assert.equal(a.writes.length, 1);
});

test('returning to vacation on the same day does not repeat a sensor action', async () => {
    const a = adapter({ simulationEntries: [{ enabled: true, targetId: 'button', kind: 'button', triggerType: 'brightness', threshold: 30, probability: 100 }] });
    a.mode = 'vacation'; a.scheduleDailySimulation();
    await a.evaluateSensorSimulation(20, NaN);
    a.mode = 'home'; a.scheduleDailySimulation();
    a.mode = 'vacation'; a.scheduleDailySimulation();
    await a.evaluateSensorSimulation(10, NaN);
    assert.equal(a.writes.length, 1);
});

test('time rules retain their plan during periodic scheduling; invalid times are rejected', () => {
    const a = adapter({ simulationEntries: [{ enabled: true, targetId: 'lamp', start: '00:00', end: '23:59', probability: 100 }] });
    a.mode = 'away'; a.scheduleDailySimulation();
    const plan = a.simulationPlans.get(0);
    a.scheduleDailySimulation();
    assert.equal(a.simulationPlans.get(0), plan);
    assert.equal(a.timeToday('25:70', new Date()), null);
});

test('delayed consumer action checks current mode before writing', async () => {
    const a = adapter({ actions: [{ enabled: true, onaway: true, targetId: 'lamp', value: 'true', valueType: 'boolean' }] });
    a.mode = 'away'; await a.runActions('away'); a.mode = 'home';
    await [...a.timers.values()][0].fn();
    assert.equal(a.writes.length, 0);
});

test('migration preserves unrestricted and dark-only behavior in both tabs', async () => {
    const a = adapter({ actions: [{ onhome: true, onlyDark: false }], shutterModeActions: [{ onlyDark: true }, { whenDark: false, whenBright: false }] });
    await a.migrateActions();
    assert.equal(a.migration.native.actions[0].whenBright, true);
    assert.equal(a.migration.native.shutterModeActions[0].whenBright, false);
    assert.equal(a.config.shutterModeActions[1].whenDark, false);
    a.migration = undefined;
    await a.migrateActions();
    assert.equal(a.migration, undefined);
});

test('consumer rules support bright, dark, unrestricted and no selection', async () => {
    const actions = [
        { targetId: 'bright', whenBright: true }, { targetId: 'dark', whenDark: true },
        { targetId: 'always', whenBright: true, whenDark: true }, { targetId: 'never', whenDark: false, whenBright: false }
    ].map(rule => ({ enabled: true, onaway: true, value: 'true', valueType: 'boolean', ...rule }));
    for (const [light, expected] of [['bright', ['bright', 'always']], ['dark', ['dark', 'always']], ['unknown', ['always']]]) {
        const a = adapter({ actions });
        a.mode = 'away'; a.lightState = light;
        await a.runActions('away');
        for (const timer of a.timers.values()) await timer.fn();
        assert.deepEqual(a.writes.map(([target]) => target), expected);
    }
});

test('shutter rules use the matching light window and recheck its end after delay', async () => {
    let time = new Date(2026, 10, 9, 5, 59);
    class TestDate extends Date { constructor() { super(time); } }
    const action = { enabled: true, mode: 'away', action: 'customButton', customTargetId: 'shutter', whenDark: true, whenBright: true, darkFrom: '18:00', darkUntil: '06:00', brightFrom: '07:00', brightUntil: '18:00' };
    const a = adapter({ shutterModeActions: [action] }, TestDate);
    a.mode = 'away'; a.lightState = 'dark';
    assert.equal(a.matchesActionLight(action, new Date(2026, 10, 8, 18, 0)), true);
    await a.runShutterActions('away');
    assert.equal(a.timers.size, 1);
    time = new Date(2026, 10, 9, 6, 0);
    await [...a.timers.values()][0].fn();
    assert.equal(a.writes.length, 0);
    assert.equal(a.matchesActionLight(action, new Date(2026, 10, 9, 7, 0)), false);
    a.lightState = 'bright';
    assert.equal(a.matchesActionLight(action, new Date(2026, 10, 9, 7, 0)), true);
    assert.equal(a.matchesActionLight(action, new Date(2026, 10, 9, 18, 0)), false);
    assert.equal(a.matchesActionLight({ ...action, brightUntil: '' }, time), false);
});
