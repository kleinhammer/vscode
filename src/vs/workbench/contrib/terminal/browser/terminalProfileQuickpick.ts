/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { iconRegistry, Codicon } from 'vs/base/common/codicons';
import { URI } from 'vs/base/common/uri';
import { ConfigurationTarget, IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IQuickInputService, IKeyMods, IPickOptions, IQuickPickSeparator, IQuickInputButton, IQuickPickItem } from 'vs/platform/quickinput/common/quickInput';
import { IExtensionTerminalProfile, ITerminalProfile, ITerminalProfileObject, TerminalSettingPrefix } from 'vs/platform/terminal/common/terminal';
import { getUriClasses, getColorClass, getColorStyleElement } from 'vs/workbench/contrib/terminal/browser/terminalIcon';
import { configureTerminalProfileIcon } from 'vs/workbench/contrib/terminal/browser/terminalIcons';
import * as nls from 'vs/nls';
import { IThemeService, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { ITerminalProfileService } from 'vs/workbench/contrib/terminal/common/terminal';

export class TerminalProfileQuickpick {
	constructor(
		@ITerminalProfileService private readonly _terminalProfileService: ITerminalProfileService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IQuickInputService private readonly _quickInputService: IQuickInputService,
		@IThemeService private readonly _themeService: IThemeService
	) { }

	async showAndGetResult(type: 'setDefault' | 'createInstance', cwd?: string | URI): Promise<IProfileQuickPickItem | undefined> {
		const profiles = this._terminalProfileService.availableProfiles;
		const profilesKey = this._terminalProfileService.profilesKey;
		const defaultProfileName = this._terminalProfileService.getConfiguredDefaultProfileName();
		let keyMods: IKeyMods | undefined;
		const options: IPickOptions<IProfileQuickPickItem> = {
			placeHolder: type === 'createInstance' ? nls.localize('terminal.integrated.selectProfileToCreate', "Select the terminal profile to create") : nls.localize('terminal.integrated.chooseDefaultProfile', "Select your default terminal profile"),
			onDidTriggerItemButton: async (context) => {
				if ('command' in context.item.profile) {
					return;
				}
				if ('id' in context.item.profile) {
					return;
				}
				const configProfiles = await this._terminalProfileService.getConfiguredProfiles();
				const existingProfiles = !!configProfiles ? Object.keys(configProfiles) : [];
				const name = await this._quickInputService.input({
					prompt: nls.localize('enterTerminalProfileName', "Enter terminal profile name"),
					value: context.item.profile.profileName,
					validateInput: async input => {
						if (existingProfiles.includes(input)) {
							return nls.localize('terminalProfileAlreadyExists', "A terminal profile already exists with that name");
						}
						return undefined;
					}
				});
				if (!name) {
					return;
				}
				const newConfigValue: { [key: string]: ITerminalProfileObject } = { ...configProfiles } ?? {};
				newConfigValue[name] = {
					path: context.item.profile.path,
					args: context.item.profile.args
				};
				await this._configurationService.updateValue(profilesKey, newConfigValue, ConfigurationTarget.USER);
			},
			onKeyMods: mods => keyMods = mods
		};

		// Build quick pick items
		const quickPickItems: (IProfileQuickPickItem | IQuickPickSeparator)[] = [];
		const configProfiles = profiles.filter(e => !e.isAutoDetected);
		const autoDetectedProfiles = profiles.filter(e => e.isAutoDetected);

		if (configProfiles.length > 0) {
			quickPickItems.push({ type: 'separator', label: nls.localize('terminalProfiles', "profiles") });
			quickPickItems.push(...this._sortProfileQuickPickItems(configProfiles.map(e => this._createProfileQuickPickItem(e)), defaultProfileName));
		}

		quickPickItems.push({ type: 'separator', label: nls.localize('ICreateContributedTerminalProfileOptions', "contributed") });
		const contributedProfiles: IProfileQuickPickItem[] = [];
		for (const contributed of this._terminalProfileService.contributedProfiles) {
			if (typeof contributed.icon === 'string' && contributed.icon.startsWith('$(')) {
				contributed.icon = contributed.icon.substring(2, contributed.icon.length - 1);
			}
			const icon = contributed.icon && typeof contributed.icon === 'string' ? (iconRegistry.get(contributed.icon) || Codicon.terminal) : Codicon.terminal;
			const uriClasses = getUriClasses(contributed, this._themeService.getColorTheme().type, true);
			const colorClass = getColorClass(contributed);
			const iconClasses = [];
			if (uriClasses) {
				iconClasses.push(...uriClasses);
			}
			if (colorClass) {
				iconClasses.push(colorClass);
			}
			contributedProfiles.push({
				label: `$(${icon.id}) ${contributed.title}`,
				profile: {
					extensionIdentifier: contributed.extensionIdentifier,
					title: contributed.title,
					icon: contributed.icon,
					id: contributed.id,
					color: contributed.color
				},
				profileName: contributed.title,
				iconClasses
			});
		}

		if (contributedProfiles.length > 0) {
			quickPickItems.push(...this._sortProfileQuickPickItems(contributedProfiles, defaultProfileName));
		}

		if (autoDetectedProfiles.length > 0) {
			quickPickItems.push({ type: 'separator', label: nls.localize('terminalProfiles.detected', "detected") });
			quickPickItems.push(...this._sortProfileQuickPickItems(autoDetectedProfiles.map(e => this._createProfileQuickPickItem(e)), defaultProfileName));
		}
		const styleElement = getColorStyleElement(this._themeService.getColorTheme());
		document.body.appendChild(styleElement);

		const value = await this._quickInputService.pick(quickPickItems, options);
		document.body.removeChild(styleElement);
		if (!value) {
			return undefined;
		}
		value.keyMods = keyMods;
		const defaultProfileKey = `${TerminalSettingPrefix.DefaultProfile}${this._terminalProfileService.platformKey}`;
		if (type === 'setDefault') {
			console.log(value.profile);
			if ('command' in value.profile) {
				return; // Should never happen
			} else if ('id' in value.profile) {
				// extension contributed profile
				await this._configurationService.updateValue(defaultProfileKey, value.profile.title, ConfigurationTarget.USER);

				this._terminalProfileService.registerContributedProfile(value.profile.extensionIdentifier, value.profile.id, value.profile.title, {
					color: value.profile.color,
					icon: value.profile.icon
				});
				return;
			}

			// Add the profile to settings if necessary
			if ('isAutoDetected' in value.profile) {
				const profilesConfig = await this._configurationService.getValue(profilesKey);
				if (typeof profilesConfig === 'object') {
					const newProfile: ITerminalProfileObject = {
						path: value.profile.path
					};
					if (value.profile.args) {
						newProfile.args = value.profile.args;
					}
					(profilesConfig as { [key: string]: ITerminalProfileObject })[value.profile.profileName] = newProfile;
				}
				await this._configurationService.updateValue(profilesKey, profilesConfig, ConfigurationTarget.USER);
			}
			// Set the default profile
			await this._configurationService.updateValue(defaultProfileKey, value.profileName, ConfigurationTarget.USER);
			this._terminalProfileService.refreshAvailableProfiles();
		}
		return value;
	}

	private _createProfileQuickPickItem(profile: ITerminalProfile): IProfileQuickPickItem {
		const buttons: IQuickInputButton[] = [{
			iconClass: ThemeIcon.asClassName(configureTerminalProfileIcon),
			tooltip: nls.localize('createQuickLaunchProfile', "Configure Terminal Profile")
		}];
		const icon = (profile.icon && ThemeIcon.isThemeIcon(profile.icon)) ? profile.icon : Codicon.terminal;
		const label = `$(${icon.id}) ${profile.profileName}`;
		const colorClass = getColorClass(profile);
		const iconClasses = [];
		if (colorClass) {
			iconClasses.push(colorClass);
		}

		if (profile.args) {
			if (typeof profile.args === 'string') {
				return { label, description: `${profile.path} ${profile.args}`, profile, profileName: profile.profileName, buttons, iconClasses };
			}
			const argsString = profile.args.map(e => {
				if (e.includes(' ')) {
					return `"${e.replace('/"/g', '\\"')}"`;
				}
				return e;
			}).join(' ');
			return { label, description: `${profile.path} ${argsString}`, profile, profileName: profile.profileName, buttons, iconClasses };
		}
		return { label, description: profile.path, profile, profileName: profile.profileName, buttons, iconClasses };
	}

	private _sortProfileQuickPickItems(items: IProfileQuickPickItem[], defaultProfileName: string) {
		return items.sort((a, b) => {
			if (b.profileName === defaultProfileName) {
				return 1;
			}
			if (a.profileName === defaultProfileName) {
				return -1;
			}
			return a.profileName.localeCompare(b.profileName);
		});
	}
}

interface IProfileQuickPickItem extends IQuickPickItem {
	profile: ITerminalProfile | IExtensionTerminalProfile;
	profileName: string;
	keyMods?: IKeyMods | undefined;
}
