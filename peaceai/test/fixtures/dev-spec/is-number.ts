// Vendored from sindresorhus/is (dev split, MIT). Not a held-out repo.
// Copyright (c) Sindre Sorhus (https://sindresorhus.com)
// SPDX-License-Identifier: MIT
// The upstream copyright line also names an email address. It is omitted here so the leak scan stays clean.

export function isNumber(value: unknown): value is number {
	return typeof value === "number" && !Number.isNaN(value);
}

export function isPositiveNumber(value: unknown): boolean {
	return isNumber(value) && value > 0;
}
