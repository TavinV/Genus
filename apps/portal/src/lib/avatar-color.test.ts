import { describe, expect, it } from 'vitest';
import { avatarColor, hashName, normalizeName } from './avatar-color';

describe('avatarColor', () => {
  it('é determinística: o mesmo nome dá sempre a mesma cor', () => {
    expect(avatarColor('Otávio Vinícius')).toEqual(avatarColor('Otávio Vinícius'));
    expect(hashName('Telma Alves')).toBe(hashName('Telma Alves'));
  });

  it('nomes diferentes dão cores diferentes', () => {
    expect(avatarColor('Otávio Vinícius').background).not.toBe(avatarColor('Telma Alves').background);
    expect(avatarColor('Ana Lima').background).not.toBe(avatarColor('Ana Lime').background);
  });

  it('ignora acento, maiúsculas e espaços a mais', () => {
    expect(normalizeName('  Otávio   VINÍCIUS ')).toBe('otavio vinicius');
    expect(avatarColor('otavio vinicius')).toEqual(avatarColor('Otávio Vinícius'));
  });

  it('gera OKLCH na faixa legível com texto branco', () => {
    const { background, color } = avatarColor('Maria Fictícia');
    expect(color).toBe('#ffffff');
    const m = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(background);
    expect(m).not.toBeNull();
    const [l, c, h] = [Number(m![1]), Number(m![2]), Number(m![3])];
    expect(l).toBeGreaterThanOrEqual(0.44);
    expect(l).toBeLessThanOrEqual(0.56);
    expect([0.11, 0.15]).toContain(c);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
  });

  it('espalha bem: 2.000 nomes quase sem colisão', () => {
    const colors = new Set<string>();
    for (let i = 0; i < 2000; i++) colors.add(avatarColor(`Colaborador ${i} da Silva`).background);
    expect(colors.size).toBeGreaterThan(1900);
  });
});
