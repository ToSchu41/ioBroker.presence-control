'use strict';

const utils = require('@iobroker/adapter-core');

class PresenceControl extends utils.Adapter {
    constructor(options = {}) {
        super({ ...options, name: 'presence-control' });
        this.mode = 'unknown';
        this.lightState = 'unknown';
        this.pendingModeTimer = null;
        this.actionTimers = new Set();
        this.simulationTimers = new Set();
        this.lastResidentsUpdate = 0;
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    async onReady() {
        await this.createObjects();
        await this.setStateAsync('info.connection', true, true);
        await this.setStateAsync('control.overrideMode', 'auto', true);
        await this.subscribeConfiguredStates();
        await this.evaluateAll();
        this.scheduleDailySimulation();
        this.healthTimer = setInterval(() => this.checkSourceHealth(), 60_000);
        this.dailyTimer = setInterval(() => this.scheduleDailySimulation(), 60 * 60 * 1000);
    }

    async createObjects() {
        const states = [
            ['info.connection', 'Verbindung', 'boolean', 'indicator.connected', false],
            ['info.lastAction', 'Letzte Aktion', 'string', 'text', false],
            ['info.nextSimulationAction', 'Nächste Simulationsaktion', 'string', 'text', false],
            ['state.mode', 'Gebäudemodus', 'string', 'text', false],
            ['state.anyoneHome', 'Jemand zuhause', 'boolean', 'indicator', false],
            ['state.longAbsent', 'Länger abwesend', 'boolean', 'indicator', false],
            ['state.isDark', 'Dunkel', 'boolean', 'indicator', false],
            ['state.lightState', 'Lichtzustand', 'string', 'text', false],
            ['state.simulationActive', 'Simulation aktiv', 'boolean', 'indicator', false],
            ['state.sourceValid', 'Residents-Quelle gültig', 'boolean', 'indicator', false],
            ['control.overrideMode', 'Override-Modus', 'string', 'state', true],
            ['control.triggerHome', 'Zuhause auslösen', 'boolean', 'button', true],
            ['control.triggerAway', 'Abwesend auslösen', 'boolean', 'button', true],
            ['control.triggerVacation', 'Urlaub auslösen', 'boolean', 'button', true],
            ['control.stopSimulation', 'Simulation stoppen', 'boolean', 'button', true]
        ];
        for (const [id, name, type, role, write] of states) {
            await this.setObjectNotExistsAsync(id, {
                type: 'state',
                common: { name, type, role, read: true, write },
                native: {}
            });
        }
    }

    async subscribeConfiguredStates() {
        const ids = [
            this.config.residentsAnyoneHomeId,
            this.config.residentsLongAbsentId,
            this.config.sunElevationId,
            this.config.brightnessId
        ].filter(Boolean);
        ids.forEach(id => this.subscribeForeignStates(id));
        this.subscribeStates('control.*');
    }

    async onStateChange(id, state) {
        if (!state) return;
        if (id.startsWith(`${this.namespace}.control.`) && !state.ack) {
            const localId = id.substring(this.namespace.length + 1);
            if (localId === 'control.triggerHome') await this.requestMode('home', 0);
            if (localId === 'control.triggerAway') await this.requestMode('away', 0);
            if (localId === 'control.triggerVacation') await this.requestMode('vacation', 0);
            if (localId === 'control.stopSimulation') this.clearSimulationTimers();
            if (localId === 'control.overrideMode') await this.evaluatePresence();
            await this.setStateAsync(localId, state.val, true);
            return;
        }
        if (id === this.config.residentsAnyoneHomeId || id === this.config.residentsLongAbsentId) {
            this.lastResidentsUpdate = Date.now();
            await this.evaluatePresence();
        }
        if (id === this.config.sunElevationId || id === this.config.brightnessId) {
            await this.evaluateLight();
        }
    }

    async evaluateAll() {
        await this.evaluateLight();
        await this.evaluatePresence();
    }

    async evaluatePresence() {
        const override = (await this.getStateAsync('control.overrideMode'))?.val || 'auto';
        if (override !== 'auto') {
            await this.requestMode(String(override), 0);
            return;
        }
        const homeState = this.config.residentsAnyoneHomeId
            ? await this.getForeignStateAsync(this.config.residentsAnyoneHomeId)
            : null;
        const vacationState = this.config.residentsLongAbsentId
            ? await this.getForeignStateAsync(this.config.residentsLongAbsentId)
            : null;
        const anyoneHome = this.toBool(homeState?.val);
        const longAbsent = this.toBool(vacationState?.val);
        if (homeState) this.lastResidentsUpdate = Math.max(this.lastResidentsUpdate, homeState.ts || 0);
        await this.setStateAsync('state.anyoneHome', anyoneHome, true);
        await this.setStateAsync('state.longAbsent', longAbsent, true);
        await this.setStateAsync('state.sourceValid', Boolean(homeState), true);
        if (!homeState) return this.requestMode('unknown', 0);
        if (anyoneHome) return this.requestMode('home', Number(this.config.homeDelaySec) || 0);
        if (longAbsent) return this.requestMode('vacation', Number(this.config.awayDelaySec) || 0);
        return this.requestMode('away', Number(this.config.awayDelaySec) || 0);
    }

    async requestMode(newMode, delaySec) {
        if (newMode === this.mode) return;
        if (this.pendingModeTimer) clearTimeout(this.pendingModeTimer);
        this.pendingModeTimer = setTimeout(async () => {
            this.pendingModeTimer = null;
            await this.applyMode(newMode);
        }, Math.max(0, delaySec) * 1000);
    }

    async applyMode(newMode) {
        const oldMode = this.mode;
        this.mode = newMode;
        await this.setStateAsync('state.mode', newMode, true);
        this.log.info(`Gebäudemodus: ${oldMode} -> ${newMode}`);
        if (this.config.shutterEnabled) await this.syncShuttercontrol(newMode);
        if (newMode === 'home') this.clearSimulationTimers();
        await this.runActions(newMode);
        this.scheduleDailySimulation();
    }

    async syncShuttercontrol(mode) {
        try {
            if (this.config.shutterHolidayId) {
                await this.setForeignStateAsync(this.config.shutterHolidayId, mode === 'vacation', false);
            }
            if (mode === 'home' && this.config.shutterAutoAllId) {
                await this.triggerButton(this.config.shutterAutoAllId);
            }
        } catch (error) {
            this.log.warn(`Shuttercontrol konnte nicht synchronisiert werden: ${error.message}`);
        }
    }

    async evaluateLight() {
        const brightness = this.config.brightnessId
            ? await this.getForeignStateAsync(this.config.brightnessId)
            : null;
        const elevation = this.config.sunElevationId
            ? await this.getForeignStateAsync(this.config.sunElevationId)
            : null;
        const lux = Number(brightness?.val);
        const elev = Number(elevation?.val);
        let dark;
        const mode = this.config.lightSourceMode || 'brightnessFallbackSun';
        if (mode === 'brightness' && Number.isFinite(lux)) dark = this.applyHysteresis(lux, this.config.darkLux, this.config.brightLux, true);
        else if (mode === 'sun' && Number.isFinite(elev)) dark = this.applyHysteresis(elev, this.config.darkElevation, this.config.brightElevation, false);
        else if (mode === 'both' && Number.isFinite(lux) && Number.isFinite(elev)) {
            dark = lux <= Number(this.config.darkLux) && elev <= Number(this.config.darkElevation);
        } else if (Number.isFinite(lux)) dark = this.applyHysteresis(lux, this.config.darkLux, this.config.brightLux, true);
        else if (Number.isFinite(elev)) dark = this.applyHysteresis(elev, this.config.darkElevation, this.config.brightElevation, false);
        else dark = undefined;
        this.lightState = dark === undefined ? 'unknown' : dark ? 'dark' : 'bright';
        await this.setStateAsync('state.isDark', dark === true, true);
        await this.setStateAsync('state.lightState', this.lightState, true);
    }

    applyHysteresis(value, darkLimit, brightLimit, lowerMeansDark) {
        if (lowerMeansDark) {
            if (value <= Number(darkLimit)) return true;
            if (value >= Number(brightLimit)) return false;
        } else {
            if (value <= Number(darkLimit)) return true;
            if (value >= Number(brightLimit)) return false;
        }
        return this.lightState === 'dark';
    }

    async runActions(trigger) {
        for (const action of this.config.actions || []) {
            if (!action.enabled || action.trigger !== trigger || !action.targetId) continue;
            if (action.onlyDark && this.lightState !== 'dark') continue;
            const timer = setTimeout(async () => {
                try {
                    const value = this.parseValue(action.value, action.valueType);
                    await this.setForeignStateAsync(action.targetId, value, false);
                    await this.setStateAsync('info.lastAction', `${action.name}: ${action.targetId} = ${String(value)}`, true);
                    if (Number(action.offAfterSec) > 0 && action.valueType === 'boolean' && value === true) {
                        const offTimer = setTimeout(() => this.setForeignState(action.targetId, false, false), Number(action.offAfterSec) * 1000);
                        this.actionTimers.add(offTimer);
                    }
                } catch (error) {
                    this.log.warn(`Aktion '${action.name}' fehlgeschlagen: ${error.message}`);
                }
            }, Math.max(0, Number(action.delaySec) || 0) * 1000);
            this.actionTimers.add(timer);
        }
    }

    scheduleDailySimulation() {
        this.clearSimulationTimers();
        const allowed = this.config.simulationEnabled && (!this.config.simulationOnlyVacation || this.mode === 'vacation');
        this.setState('state.simulationActive', allowed, true);
        if (!allowed) return;
        const now = new Date();
        let nextText = '';
        for (const entry of this.config.simulationEntries || []) {
            if (!entry.enabled || !entry.targetId || Math.random() * 100 > Number(entry.probability ?? 100)) continue;
            const start = this.timeToday(entry.start, now);
            let end = this.timeToday(entry.end, now);
            if (end <= start) end.setDate(end.getDate() + 1);
            const fireAt = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
            if (fireAt <= now) continue;
            const timer = setTimeout(() => this.executeSimulationEntry(entry), fireAt.getTime() - now.getTime());
            this.simulationTimers.add(timer);
            const label = `${entry.name}: ${fireAt.toLocaleString('de-DE')}`;
            if (!nextText || fireAt < new Date(nextText.date || 8640000000000000)) nextText = label;
        }
        this.setState('info.nextSimulationAction', nextText || 'Keine geplant', true);
    }

    async executeSimulationEntry(entry) {
        if (this.mode === 'home' || (entry.onlyDark && this.lightState !== 'dark')) return;
        try {
            if (entry.kind === 'button') {
                await this.triggerButton(entry.targetId);
            } else {
                await this.setForeignStateAsync(entry.targetId, true, false);
                const min = Number(entry.minDurationMin) || 1;
                const max = Math.max(min, Number(entry.maxDurationMin) || min);
                const duration = min + Math.random() * (max - min);
                const offTimer = setTimeout(() => this.setForeignState(entry.targetId, false, false), duration * 60_000);
                this.simulationTimers.add(offTimer);
            }
            await this.setStateAsync('info.lastAction', `Simulation: ${entry.name}`, true);
        } catch (error) {
            this.log.warn(`Simulation '${entry.name}' fehlgeschlagen: ${error.message}`);
        }
    }

    async triggerButton(id) {
        await this.setForeignStateAsync(id, true, false);
    }

    timeToday(value, base) {
        const [hours, minutes] = String(value || '00:00').split(':').map(Number);
        const result = new Date(base);
        result.setHours(hours || 0, minutes || 0, 0, 0);
        return result;
    }

    parseValue(value, type) {
        if (type === 'boolean') return this.toBool(value);
        if (type === 'number') return Number(value);
        return String(value);
    }

    toBool(value) {
        return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true' || String(value).toLowerCase() === 'home';
    }

    async checkSourceHealth() {
        const maxAge = Math.max(1, Number(this.config.unknownAfterMin) || 60) * 60_000;
        const valid = this.lastResidentsUpdate > 0 && Date.now() - this.lastResidentsUpdate <= maxAge;
        await this.setStateAsync('state.sourceValid', valid, true);
        if (!valid && this.mode !== 'unknown') await this.requestMode('unknown', 0);
    }

    clearSimulationTimers() {
        for (const timer of this.simulationTimers) clearTimeout(timer);
        this.simulationTimers.clear();
        this.setState('state.simulationActive', false, true);
    }

    onUnload(callback) {
        try {
            if (this.pendingModeTimer) clearTimeout(this.pendingModeTimer);
            if (this.healthTimer) clearInterval(this.healthTimer);
            if (this.dailyTimer) clearInterval(this.dailyTimer);
            for (const timer of this.actionTimers) clearTimeout(timer);
            this.clearSimulationTimers();
            this.setState('info.connection', false, true);
            callback();
        } catch {
            callback();
        }
    }
}

if (require.main !== module) {
    module.exports = options => new PresenceControl(options);
} else {
    new PresenceControl();
}
