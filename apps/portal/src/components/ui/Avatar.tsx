import { avatarColor } from '@/lib/avatar-color';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';

const SIZE = { sm: 'h-7 w-7 text-[11px]', md: 'h-9 w-9 text-xs', lg: 'h-12 w-12 text-sm' } as const;

/**
 * Iniciais num círculo, com a cor derivada do nome completo (lib/avatar-color.ts): a mesma pessoa tem
 * sempre a mesma cor. Decorativo: o nome sempre aparece ao lado.
 */
export function Avatar({ name, size = 'md', className = '' }: { name: string; size?: keyof typeof SIZE; className?: string }) {
  return (
    <span aria-hidden style={avatarColor(name)} className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-bold', SIZE[size], className)}>
      {initials(name)}
    </span>
  );
}
