import { v7 as uuidv7 } from 'uuid';

export function generateId(): string {
  return uuidv7();
}

export function isValidId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}
