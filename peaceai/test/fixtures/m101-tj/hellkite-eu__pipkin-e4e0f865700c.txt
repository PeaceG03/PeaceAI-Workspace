import { BoundingBox } from '../types';

export const toPx = (value: number): string => `${value}px`;

export const boundingBoxToPx = (
    boundingBox: BoundingBox,
): Record<string, string> => {
    return Object.entries(boundingBox)
        .map(([key, value]) => [key, toPx(value)])
        .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});
};
