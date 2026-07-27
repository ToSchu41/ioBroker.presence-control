'use strict';

const utils = require('@iobroker/adapter-core');

class PresenceControl extends utils.Adapter {
    constructor(options = {}) {
        super({ ...options, name: 'presence-control' });
        this.mode = 'unknown';
        this.lightState = 'unknown';
        this.initialModeApplied = false;
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
        const override = await this.getStateAsync('control.overrideMode');
        if (!override) await this.setStateAsync('control.overrideMode', 'auto', true);
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
            ['info.lastNotification', 'Letzte Benachrichtigung', 'string', 'text', false],
            ['info.lastNotificationTime', 'Zeitpunkt letzte Benachrichtigung', 'number', 'value.time', false],
            ['info.lastNotificationError', 'Letzter Benachrichtigungsfehler', 'string', 'text', false],
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
            ['control.triggerUnknown', 'Unbekannt auslösen', 'boolean', 'button', true],
            ['control.stopSimulation', 'Simulation stoppen', 'boolean', 'button', true]
        ];
        for (const [id, name, type, role, write] of states) {
            await this.setObjectNotExistsAsync(id, {
                type: 'state', common: { name, type, role, read: true, write }, native: {}
            });
        }
    }

    async subscribeConfiguredStates() {
        [this.config.residentsAnyoneHomeId, this.config.residentsLongAbsentId,
            this.config.sunElevationId, this.config.brightnessId]
            .filter(Boolean).forEach(id => this.subscribeForeignStates(id));
        this.subscribeStates('control.*');
    }

    async onStateChange(id, state) {
        if (!state) return;
        if (id.startsWith(`${this.namespace}.control.`) && !state.ack) {
            const localId = id.substring(this.namespace.length + 1);
            if (localId === 'control.triggerHome') await this.requestMode('home', 0);
            if (localId === 'control.triggerAway') await this.requestMode('away', 0);
            if (localId === 'control.triggerVacation') await this.requestMode('vacation', 0);
            if (localId === 'control.triggerUnknown') await this.requestMode('unknown', 0);
            if (localId === 'control.stopSimulation') this.clearSimulationTimers();
            if (localId === 'control.overrideMode') await this.evaluatePresence();
            await this.setStateAsync(localId, state.val, true);
            return;
        }
        if (id === this.config.residentsAnyoneHomeId || id === this.config.residentsLongAbsentId) {
            this.lastResidentsUpdate = Date.now();
            await this.evaluatePresence();
        }
        if (id === this.config.sunElevationId || id === this.config.brightnessId) await this.evaluateLight();
    }

    async evaluateAll() {
        await this.evaluateLight();
        await this.evaluatePresence();
    }

    async evaluatePresence() {
        if (!this.config.enabled) return;
        const override = (await this.getStateAsync('control.overrideMode'))?.val || 'auto';
        if (override !== 'auto') return this.requestMode(String(override), 0);

        const homeState = this.config.residentsAnyoneHomeId ? await this.getForeignStateAsync(this.config.residentsAnyoneHomeId) : null;
        const vacationState = this.config.residentsLongAbsentId ? await this.getForeignStateAsync(this.config.residentsLongAbsentId) : null;
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
        if (newMode === this.mode && this.initialModeApplied) return;
        if (this.pendingModeTimer) clearTimeout(this.pendingModeTimer);
        this.pendingModeTimer = setTimeout(async () => {
            this.pendingModeTimer = null;
            await this.applyMode(newMode);
        }, Math.max(0, delaySec) * 1000);
    }

    async applyMode(newMode) {
        const oldMode = this.mode;
        const isStartup = !this.initialModeApplied;
        this.mode = newMode;
        this.initialModeApplied = true;
        await this.setStateAsync('state.mode', newMode, true);
        this.log.info(`Gebäudemodus: ${oldMode} -> ${newMode}${isStartup ? ' (Start)' : ''}`);

        if (newMode === 'home') this.clearSimulationTimers();
        if (this.config.shutterEnabled) await this.runShutterActions(newMode);
        await this.runActions(newMode);
        await this.sendModeNotification(newMode, oldMode, isStartup);
        this.scheduleDailySimulation();
    }

    async runShutterActions(mode) {
        for (const action of this.config.shutterModeActions || []) {
            if (!action.enabled || action.mode !== mode) continue;
            if (action.onlyDark && this.lightState !== 'dark') {
                this.log.debug(`Shuttercontrol-Aktion '${action.name}' übersprungen: nicht dunkel`);
                continue;
            }
            const targetId = this.resolveShutterTarget(action.action, action.customTargetId);
            if (!targetId) continue;
            const timer = setTimeout(async () => {
                try {
                    if (action.action === 'holidayOn') await this.setForeignStateAsync(targetId, true, false);
                    else if (action.action === 'holidayOff') await this.setForeignStateAsync(targetId, false, false);
                    else await this.triggerButton(targetId);
                    const text = `${action.name || action.action}: ${targetId}`;
                    await this.setStateAsync('info.lastAction', text, true);
                    this.log.info(`Shuttercontrol: ${text}`);
                } catch (error) {
                    this.log.warn(`Shuttercontrol-Aktion '${action.name || action.action}' fehlgeschlagen: ${error.message}`);
                }
            }, Math.max(0, Number(action.delaySec) || 0) * 1000);
            this.actionTimers.add(timer);
        }
    }

    resolveShutterTarget(action, customTargetId) {
        const map = {
            holidayOn: this.config.shutterHolidayId,
            holidayOff: this.config.shutterHolidayId,
            autoAll: this.config.shutterAutoAllId,
            openAll: this.config.shutterOpenAllId,
            closeAll: this.config.shutterCloseAllId,
            openLiving: this.config.shutterOpenLivingId,
            closeLiving: this.config.shutterCloseLivingId,
            openChildren: this.config.shutterOpenChildrenId,
            closeChildren: this.config.shutterCloseChildrenId,
            openSleep: this.config.shutterOpenSleepId,
            closeSleep: this.config.shutterCloseSleepId,
            customButton: customTargetId
        };
        return map[action] || '';
    }

    async sendModeNotification(mode, previousMode, isStartup) {
        if (!this.config.telegramEnabled) return;
        if (isStartup && !this.config.telegramNotifyOnStartup) return;
        const notifyFlag = this.config[`telegramNotify${mode[0].toUpperCase()}${mode.slice(1)}`];
        if (notifyFlag === false) return;
        const template = this.config[`telegramText${mode[0].toUpperCase()}${mode.slice(1)}`];
        if (!template) return;
        const text = this.replacePlaceholders(template, mode, previousMode);
        const instance = this.config.telegramInstance || 'telegram.0';
        const payload = { text };
        if (this.config.telegramUser) payload.user = this.config.telegramUser;
        try {
            await new Promise((resolve, reject) => {
                this.sendTo(instance, 'send', payload, response => {
                    if (response && response.error) reject(new Error(String(response.error)));
                    else resolve(response);
                });
            });
            await this.setStateAsync('info.lastNotification', text, true);
            await this.setStateAsync('info.lastNotificationTime', Date.now(), true);
            await this.setStateAsync('info.lastNotificationError', '', true);
        } catch (error) {
            await this.setStateAsync('info.lastNotificationError', error.message, true);
            this.log.warn(`Telegram-Benachrichtigung fehlgeschlagen: ${error.message}`);
        }
    }

    replacePlaceholders(text, mode, previousMode) {
        const now = new Date();
        const modeNames = {
            home: this.config.modeNameHome || 'Home', away: this.config.modeNameAway || 'Away',
            vacation: this.config.modeNameVacation || 'Vacation', unknown: this.config.modeNameUnknown || 'Unknown'
        };
        return String(text)
            .replaceAll('{mode}', modeNames[mode] || mode)
            .replaceAll('{previousMode}', modeNames[previousMode] || previousMode)
            .replaceAll('{date}', now.toLocaleDateString('de-DE'))
            .replaceAll('{time}', now.toLocaleTimeString('de-DE'));
    }

    async evaluateLight() {
        const brightness = this.config.brightnessId ? await this.getForeignStateAsync(this.config.brightnessId) : null;
        const elevation = this.config.sunElevationId ? await this.getForeignStateAsync(this.config.sunElevationId) : null;
        const lux = Number(brightness?.val);
        const elev = Number(elevation?.val);
        let dark;
        const mode = this.config.lightSourceMode || 'brightnessFallbackSun';
        if (mode === 'brightness' && Number.isFinite(lux)) dark = this.applyHysteresis(lux, this.config.darkLux, this.config.brightLux);
        else if (mode === 'sun' && Number.isFinite(elev)) dark = this.applyHysteresis(elev, this.config.darkElevation, this.config.brightElevation);
        else if (mode === 'both' && Number.isFinite(lux) && Number.isFinite(elev)) dark = lux <= Number(this.config.darkLux) && elev <= Number(this.config.darkElevation);
        else if (Number.isFinite(lux)) dark = this.applyHysteresis(lux, this.config.darkLux, this.config.brightLux);
        else if (Number.isFinite(elev)) dark = this.applyHysteresis(elev, this.config.darkElevation, this.config.brightElevation);
        this.lightState = dark === undefined ? 'unknown' : dark ? 'dark' : 'bright';
        await this.setStateAsync('state.isDark', dark === true, true);
        await this.setStateAsync('state.lightState', this.lightState, true);
    }

    applyHysteresis(value, darkLimit, brightLimit) {
        if (value <= Number(darkLimit)) return true;
        if (value >= Number(brightLimit)) return false;
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
        if (!this.config.simulationEnabled) return;
        if (this.config.simulationOnlyVacation && this.mode !== 'vacation') return;
        if (!this.config.simulationOnlyVacation && !['away', 'vacation'].includes(this.mode)) return;
        const now = new Date();
        for (const entry of this.config.simulationEntries || []) {
            if (!entry.enabled || !entry.targetId || Math.random() * 100 > Number(entry.probability ?? 100)) continue;
            const start = this.timeToday(entry.start, now);
            const end = this.timeToday(entry.end, now);
            if (!start || !end || end <= start) continue;
            const runAt = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
            if (runAt <= now) continue;
            const timer = setTimeout(() => this.executeSimulationEntry(entry), runAt.getTime() - now.getTime());
            this.simulationTimers.add(timer);
            this.setState('info.nextSimulationAction', `${entry.name}: ${runAt.toLocaleString('de-DE')}`, true);
        }
        this.setState('state.simulationActive', this.simulationTimers.size > 0, true);
    }

    async executeSimulationEntry(entry) {
        if (entry.onlyDark && this.lightState !== 'dark') return;
        try {
            if (entry.kind === 'button') await this.triggerButton(entry.targetId);
            else {
                await this.setForeignStateAsync(entry.targetId, true, false);
                const min = Math.max(0, Number(entry.minDurationMin) || 0);
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
        if (id) await this.setForeignStateAsync(id, true, false);
    }

    checkSourceHealth() {
        const maxAge = (Number(this.config.unknownAfterMin) || 60) * 60_000;
        if (this.lastResidentsUpdate && Date.now() - this.lastResidentsUpdate > maxAge) {
            this.setState('state.sourceValid', false, true);
            this.requestMode('unknown', 0);
        }
    }

    clearSimulationTimers() {
        for (const timer of this.simulationTimers) clearTimeout(timer);
        this.simulationTimers.clear();
        this.setState('state.simulationActive', false, true);
        this.setState('info.nextSimulationAction', '', true);
    }

    timeToday(value, base) {
        const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
        if (!match) return null;
        const date = new Date(base);
        date.setHours(Number(match[1]), Number(match[2]), 0, 0);
        return date;
    }

    parseValue(value, type) {
        if (type === 'boolean') return this.toBool(value);
        if (type === 'number') return Number(value);
        return String(value ?? '');
    }

    toBool(value) {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value !== 0;
        return ['true', '1', 'yes', 'on', 'home', 'present'].includes(String(value).toLowerCase());
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

if (module.parent) module.exports = options => new PresenceControl(options);
else new PresenceControl();
