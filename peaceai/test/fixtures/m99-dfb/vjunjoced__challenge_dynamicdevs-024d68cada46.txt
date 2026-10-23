import { Vector } from '../interfaces/vector';
import { Satellite } from '../interfaces/satelite';

function sqr(a: number): number {
  return a ** 2;
}

/**
 * Función que calcula la posición de la nave tomando en cuenta la posición de cada uno de los satélites y la distancia a la cual se encuentra la nave con cada uno de ellos
 * @param satellites Satelites para calcular la posición
 * @returns Retorna un Vector2D con la posicion x,y en la cual se encuentra la nave
 */
export function getLocation(satellites: Satellite[]): Vector | undefined {
  if (!Array.isArray(satellites)) return undefined;
  if (satellites.length < 3) return undefined;

  const [s1, s2, s3] = satellites;

  if (s1 === undefined || s2 === undefined || s3 === undefined)
    return undefined;
  if (
    s1.position === undefined ||
    s2.position === undefined ||
    s3.position === undefined
  )
    return undefined;
  if (!s1.distance || !s2.distance || !s3.distance) return undefined;

  const k =
    (sqr(s1.position.x) +
      sqr(s1.position.y) -
      sqr(s2.position.x) -
      sqr(s2.position.y) -
      sqr(s1.distance) +
      sqr(s2.distance)) /
      (2 * (s1.position.y - s2.position.y)) -
    (sqr(s1.position.x) +
      sqr(s1.position.y) -
      sqr(s3.position.x) -
      sqr(s3.position.y) -
      sqr(s1.distance) +
      sqr(s3.distance)) /
      (2 * (s1.position.y - s3.position.y));

  const j =
    (s3.position.x - s1.position.x) / (s1.position.y - s3.position.y) -
    (s2.position.x - s1.position.x) / (s1.position.y - s2.position.y);

  const x = k / j;

  const y =
    ((s2.position.x - s1.position.x) / (s1.position.y - s2.position.y)) * x +
    (sqr(s1.position.x) +
      sqr(s1.position.y) -
      sqr(s2.position.x) -
      sqr(s2.position.y) -
      sqr(s1.distance) +
      sqr(s2.distance)) /
      (2 * (s1.position.y - s2.position.y));

  return { x, y };
}
