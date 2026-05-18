import { Schema, ValidationError } from '../src/index';

describe('Schema', () => {
  describe('field normalization', () => {
    it('accepts shorthand type syntax', () => {
      const s = new Schema({ name: String, age: Number, active: Boolean });
      expect(s.fields.get('name')?.type).toBe(String);
      expect(s.fields.get('age')?.type).toBe(Number);
      expect(s.fields.get('active')?.type).toBe(Boolean);
    });

    it('accepts object definition syntax', () => {
      const s = new Schema({ email: { type: String, required: true, unique: true } });
      const f = s.fields.get('email')!;
      expect(f.type).toBe(String);
      expect(f.required).toBe(true);
      expect(f.unique).toBe(true);
    });

    it('supports array required message', () => {
      const s = new Schema({ name: { type: String, required: [true, 'Name is required'] } });
      expect(s.fields.get('name')?.required).toBe(true);
      expect(s.fields.get('name')?.requiredMessage).toBe('Name is required');
    });

    it('supports timestamps option', () => {
      const s = new Schema({}, { timestamps: true });
      expect(s.options.timestamps).toBe(true);
    });

    it('supports collection name override', () => {
      const s = new Schema({}, { collection: 'my_users' });
      expect(s.options.collection).toBe('my_users');
    });
  });

  describe('validate', () => {
    it('passes valid data', () => {
      const s = new Schema({ name: { type: String, required: true } });
      expect(() => s.validate({ name: 'Alice' })).not.toThrow();
    });

    it('throws on missing required field', () => {
      const s = new Schema({ name: { type: String, required: true } });
      expect(() => s.validate({})).toThrow(ValidationError);
    });

    it('throws on enum violation', () => {
      const s = new Schema({ role: { type: String, enum: ['admin', 'user'] } });
      expect(() => s.validate({ role: 'superadmin' })).toThrow(ValidationError);
    });

    it('throws on min violation', () => {
      const s = new Schema({ age: { type: Number, min: 18 } });
      expect(() => s.validate({ age: 10 })).toThrow(ValidationError);
    });

    it('throws on maxLength violation', () => {
      const s = new Schema({ bio: { type: String, maxLength: 5 } });
      expect(() => s.validate({ bio: 'too long value' })).toThrow(ValidationError);
    });
  });

  describe('applyDefaults', () => {
    it('fills in default values', () => {
      const s = new Schema({ role: { type: String, default: 'user' } });
      const result = s.applyDefaults({});
      expect(result.role).toBe('user');
    });

    it('applies trim', () => {
      const s = new Schema({ name: { type: String, trim: true } });
      expect(s.applyDefaults({ name: '  Alice  ' }).name).toBe('Alice');
    });

    it('applies lowercase', () => {
      const s = new Schema({ email: { type: String, lowercase: true } });
      expect(s.applyDefaults({ email: 'ALICE@EXAMPLE.COM' }).email).toBe('alice@example.com');
    });
  });

  describe('Schema.Types', () => {
    it('exposes Mixed and ObjectId sentinels', () => {
      expect(Schema.Types.Mixed).toBe('Mixed');
      expect(Schema.Types.ObjectId).toBe('ObjectId');
    });
  });
});
