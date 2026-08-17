// src/settings/registerFileSystemBackupSettings.ts
import { useEffect, useRef } from 'react';

import { t } from '@/i18n';
import { useSettings } from '../hooks/useSettings';

export function useRegisterFileSystemBackupSettings() {
	const { registerSetting, getSetting } = useSettings();
	const registered = useRef(false);

	useEffect(() => {
		if (registered.current) return;
		registered.current = true;

		const initialBackupEnabled =
			(getSetting('file-sys-backup-enable')?.value as boolean) ?? false;
		const initialAutoBackup =
			(getSetting('file-sys-backup-auto-backup')?.value as boolean) ?? false;
		const initialBackupOnSave =
			(getSetting('file-sys-backup-on-save')?.value as boolean) ?? false;
		const initialTimedBackup =
			(getSetting('file-sys-backup-timed-enable')?.value as boolean) ?? false;
		const initialTimedBackupInterval =
			(getSetting('file-sys-backup-timed-interval')?.value as number) ?? 15;

		registerSetting({
			id: 'file-sys-backup-enable',
			category: t('Backup'),
			subcategory: t('File System'),
			type: 'checkbox',
			label: t('Enable file system backup'),
			description: t(
				'Sync your data to a local folder for backup and sharing via cloud storage',
			),

			defaultValue: initialBackupEnabled,
		});

		registerSetting({
			id: 'file-sys-backup-auto-backup',
			category: t('Backup'),
			subcategory: t('File System'),
			type: 'checkbox',
			label: t('Auto-backup connection on startup'),
			description: t(
				'Automatically start connection to file system when the application loads (requires folder authorization)',
			),

			defaultValue: initialAutoBackup,
			dependsOn: { id: 'file-sys-backup-enable', value: true, nest: true },
			disabledReason: t('Requires: File system backup'),
		});

		registerSetting({
			id: 'file-sys-backup-on-save',
			category: t('Backup'),
			subcategory: t('File System'),
			type: 'checkbox',
			label: t('Backup on save'),
			description: t(
				'Create a backup of the active project whenever it is saved',
			),
			defaultValue: initialBackupOnSave,
			dependsOn: { id: 'file-sys-backup-enable', value: true, nest: true },
			disabledReason: t('Requires: File system backup'),
		});

		registerSetting({
			id: 'file-sys-backup-timed-enable',
			category: t('Backup'),
			subcategory: t('File System'),
			type: 'checkbox',
			label: t('Time-based backups'),
			description: t('Create backups at a regular interval'),
			defaultValue: initialTimedBackup,
			dependsOn: { id: 'file-sys-backup-enable', value: true, nest: true },
			disabledReason: t('Requires: File system backup'),
		});

		registerSetting({
			id: 'file-sys-backup-timed-interval',
			category: t('Backup'),
			subcategory: t('File System'),
			type: 'number',
			label: t('Backup interval (minutes)'),
			description: t('How often to create a backup of all projects'),
			defaultValue: initialTimedBackupInterval,
			min: 1,
			max: 1440,
			step: 1,
			validate: (value) =>
				typeof value === 'number' &&
				Number.isFinite(value) &&
				value >= 1 &&
				value <= 1440,
			liveUpdate: true,
			dependsOn: {
				id: 'file-sys-backup-timed-enable',
				value: true,
				nest: true,
			},
			disabledReason: t('Requires: Time-based backups'),
		});
	}, [registerSetting, getSetting]);
}
