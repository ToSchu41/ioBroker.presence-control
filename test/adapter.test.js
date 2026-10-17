'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function adapter(config = {}) {
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
        require: () => ({ Adapter }), module: { parent: true }, Date, Math, console,
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
