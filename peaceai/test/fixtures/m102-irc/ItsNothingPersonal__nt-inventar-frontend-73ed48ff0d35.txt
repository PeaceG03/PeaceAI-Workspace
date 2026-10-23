import { browser } from '$app/environment';
import { PUBLIC_PB_BASE_URL } from '$env/static/public';
import { Label } from './constants';
import type { DataObject } from './types/dataRow';
import type { FlattendKisteAndBestellung } from './types/flattendKisteAndBestellung';
import type { Kiste } from './types/kiste';
import type { PBUser } from './types/user';
import { UserRoles } from './types/userRoles';

export function isNullOrUndefined<T>(obj: T | null | undefined): obj is null | undefined {
	return typeof obj === 'undefined' || obj === null;
}

export function isNotNullOrUndefined<T>(obj: T | null | undefined): obj is T {
	return !isNullOrUndefined<T>(obj);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serializeNonPOJOs<T>(obj: any) {
	return structuredClone<T>(obj);
}

export function getImageURL(
	collectionId: string,
	recordId: string,
	fileName: string,
	size: string
): string {
	return `${PUBLIC_PB_BASE_URL}/api/files/${collectionId}/${recordId}/${fileName}?thumb=${size}`;
}

export function startCsvDownload(data: DataObject[], headers: string[], fileName: string) {
	const columnDelimiter = ';';
	const lineDelimiter = '\n';

	let result = '';
	result += headers.map((header) => toTitleCase(header)).join(columnDelimiter);
	result += lineDelimiter;

	data.forEach((row) => {
		result += headers.map((header) => row[header]).join(columnDelimiter);
		result += lineDelimiter;
	});

	const blob = new Blob([result]);
	if (navigator.userAgent.match(/iPhone|iPad|iPod/i)) {
		const hiddenElement = window.document.createElement('a');
		hiddenElement.href = 'data:text/csv;charset=utf-8,' + encodeURI(result);
		hiddenElement.target = '_blank';
		hiddenElement.download = fileName;
		hiddenElement.click();
	} else {
		const link = document.createElement('a');
		if (link.download !== undefined) {
			// Browsers that support HTML5 download attribute
			const url = URL.createObjectURL(blob);
			link.setAttribute('href', url);
			link.setAttribute('download', fileName);
			link.style.visibility = 'hidden';
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
		}
	}

	return;
}

export function toTitleCase(str: string): string {
	return (
		str
			.match(/[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g)
			?.map((x) => x.charAt(0).toUpperCase() + x.slice(1))
			.join(' ') ?? str
	);
}

export function sqlTimeNow(): string {
	const time = new Date().toISOString().replace('T', ' ');

	return time;
}

export function sessionStore(field: string, value: string) {
	if (browser) window.sessionStorage.setItem(field, value);
}

export function changeToTheme(currentTheme: string, newTheme: string): boolean {
	if (currentTheme !== newTheme) {
		document.documentElement.setAttribute('data-theme', newTheme);
		return true;
	} else {
		return false;
	}
}

export function sortByLagerortNameAsc(a: Kiste, b: Kiste): number {
	return a.expand.lagerort.name < b.expand.lagerort.name ? -1 : 1;
}

export function sortByLagerortNameDesc(a: Kiste, b: Kiste): number {
	return a.expand.lagerort.name > b.expand.lagerort.name ? -1 : 1;
}

export function sortByKisteNameAsc(a: Kiste, b: Kiste): number {
	return a.name < b.name ? -1 : 1;
}

export function sortByKisteNameDesc(a: Kiste, b: Kiste): number {
	return a.name > b.name ? -1 : 1;
}

export function sortByLagerortNameAndKisteNameAsc(a: Kiste, b: Kiste): number {
	if (a.expand.lagerort.name === b.expand.lagerort.name) {
		return sortByKisteNameAsc(a, b);
	} else {
		return sortByLagerortNameAsc(a, b);
	}
}

export function sortStringAsc(a: string, b: string): number {
	return a < b ? -1 : 1;
}

export function sortStringDesc(a: string, b: string): number {
	return a > b ? -1 : 1;
}

export function sortByProjektNameAndKisteNameAsc(
	a: FlattendKisteAndBestellung,
	b: FlattendKisteAndBestellung
): number {
	if (a.expand.bestellung.projekt === b.expand.bestellung.projekt) {
		return sortByKisteNameAsc(a, b);
	} else {
		return sortStringDesc(a.expand.bestellung.projekt.name, b.expand.bestellung.projekt.name);
	}
}

export function getModeLabelText(user: PBUser | undefined): string {
	if (isNullOrUndefined(user)) return '';

	let text: string;

	switch (user.role) {
		case UserRoles.INVENTARIST:
			text = Label.INTERACTIVE_MODE_BEARBEITEN;
			break;
		case UserRoles.SPIELLEITUNG:
			text = Label.INTERACTIVE_MODE_BESTELLEN;
			break;
		default:
			text = Label.INTERACTIVE_MODE_EXPORT;
	}

	return text;
}
