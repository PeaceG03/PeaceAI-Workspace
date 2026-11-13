// Vendored from sindresorhus/is (dev split, MIT). Not a held-out repo.
// Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)
// SPDX-License-Identifier: MIT

export function isNumber(value: unknown): value is number {
	return typeof value === "number" && !Number.isNaN(value);
}

export function isPositiveNumber(value: unknown): boolean {
	return isNumber(value) && value > 0;
}
