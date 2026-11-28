'use client';
/** Conta sem acesso aos módulos de RH (ex.: super_admin). Só informa e deixa sair. */
import { SignOut } from '@phosphor-icons/react';
import { Button } from '@/components/ui/Button';
import { ForbiddenState } from '@/components/ui/States';
import { useSignOut } from '@/lib/auth/gate';

export function NoAccessScreen() {
  const signOut = useSignOut();
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[640px] flex-col justify-center gap-4 p-4 md:p-8">
      <h1 className="sr-only">Sem acesso</h1>
      <ForbiddenState screen="Módulos de RH" />
      <Button variant="secondary" className="h-11 self-center" icon={<SignOut size={18} aria-hidden />} onClick={() => void signOut()}>Sair</Button>
    </main>
  );
}
