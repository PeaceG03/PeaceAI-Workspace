/** Nested tunnel used so a gap stays too big at depth 5. */
export function tunnel(x: number): number {
  if (x > 0) {
    if (x > 1) {
      if (x > 2) {
        if (x > 3) {
          if (x > 4) {
            if (x > 5) {
              return x;
            } else {
              return 5;
            }
          } else {
            return 4;
          }
        } else {
          return 3;
        }
      } else {
        return 2;
      }
    } else {
      return 1;
    }
  } else {
    return 0;
  }
}
