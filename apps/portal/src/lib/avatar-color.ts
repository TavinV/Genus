/**
 * Cor da "foto de perfil" (bolinha com as iniciais), derivada do nome completo.
 *
 * Determinística: o mesmo nome dá sempre a mesma cor, em qualquer tela, aparelho ou sessão, sem
 * guardar nada no banco. Nomes diferentes caem em cores diferentes com alta probabilidade.
 *
 * 1. Normaliza o nome: sem acento, minúsculas, espaços colapsados. "Otávio  Vinícius" e "otavio vinicius"
 *    são a mesma pessoa digitada de jeitos diferentes, então têm a mesma cor.
 * 2. Hash FNV-1a de 32 bits sobre o texto normalizado, seguido do finalizador do MurmurHash3 (fmix32),
 *    que espalha os bits: nomes parecidos ("Ana Lima" e "Ana Lime") caem longe um do outro.
 * 3. Bits diferentes do hash escolhem matiz (3600 passos de 0,1°), luminosidade (3 níveis) e croma
 *    (2 níveis): 21.600 combinações.
 * 4. A cor é OKLCH, que tem luminosidade perceptual uniforme: com L entre 0,44 e 0,56 o texto branco
 *    fica legível em qualquer matiz (contraste ≥ 4,3:1), sem o amarelo "lavado" que o HSL daria.
 */

const LIGHTNESS = [0.44, 0.5, 0.56] as const;
const CHROMA = [0.11, 0.15] as const;

export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/** FNV-1a 32 bits + fmix32 do MurmurHash3. Sem sinal (0 a 2³² − 1). */
export function hashName(name: string): number {
  const text = normalizeName(name);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export interface AvatarColor {
  /** Fundo, em `oklch(...)`. */
  background: string;
  /** Texto das iniciais. */
  color: string;
}

export function avatarColor(name: string): AvatarColor {
  const h = hashName(name);
  const hue = (h % 3600) / 10;
  const lightness = LIGHTNESS[(h >>> 12) % LIGHTNESS.length]!;
  const chroma = CHROMA[(h >>> 20) % CHROMA.length]!;
  return { background: `oklch(${lightness} ${chroma} ${hue})`, color: '#ffffff' };
}
