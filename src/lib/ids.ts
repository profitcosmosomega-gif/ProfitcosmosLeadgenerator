import { v7 as uuidv7 } from 'uuid';

/** Time-ordered UUID (v7) used as the primary key for every table. */
export function newId(): string {
  return uuidv7();
}
