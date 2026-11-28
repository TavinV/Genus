'use client';
/**
 * [SEM DESIGN] Relatórios (RF58), prévia sem back. Escolhe o tipo, preenche o pedido com validação real
 * e para aí: "Gerar relatório" fica desabilitado e nenhum arquivo é simulado.
 */
import { ChartBar, Info } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Controller } from 'react-hook-form';
import { PageHeader } from '@/components/shell/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DateInput, SelectField, TextInput } from '@/components/ui/Fields';
import { PendingBackTooltip } from '@/components/ui/PendingBackTooltip';
import { ForbiddenState } from '@/components/ui/States';
import { useZodForm } from '@/components/ui/useZodForm';
import { REPORT_TYPES, type ReportType } from '@/lib/api/contracts';
import { can } from '@/lib/auth/permissions';
import { useClock } from '@/lib/clock-context';
import { monthOf, todayCivil } from '@/lib/format';
import { REPORT_TYPE } from '@/lib/labels';
import { useApiQuery } from '@/lib/query/hooks';
import { establishmentParam, useSession } from '@/lib/session';
import { COPY, REPORT_DESCRIPTION } from './copy';
import { reportFormSchema } from './schemas';

const FORMATS = [
  { value: 'pdf', label: 'PDF' },
  { value: 'csv', label: 'CSV' },
];

export function ReportsScreen() {
  const { me } = useSession();
  const [selected, setSelected] = useState<ReportType | null>(null);

  if (!can(me.role, 'nav.reports')) {
    return <PageHeader title={COPY.title}><ForbiddenState screen={COPY.title} /></PageHeader>;
  }
  return (
    <PageHeader title={COPY.title} subtitle={COPY.subtitle}>
      <Card className="flex items-start gap-3 bg-tint p-4">
        <Info size={20} className="mt-0.5 shrink-0 text-brand" aria-hidden />
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold">{COPY.noticeTitle}</span>
          <span className="text-ink-2 text-pretty">{COPY.noticeText}</span>
        </div>
      </Card>
      <section aria-labelledby="report-pick" className="flex flex-col gap-3">
        <h2 id="report-pick" className="m-0 text-md font-bold tracking-[-0.01em]">{COPY.pickTitle}</h2>
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
          {REPORT_TYPES.map((t) => {
            const active = selected === t;
            return (
              <button
                key={t}
                type="button"
                aria-pressed={active}
                onClick={() => setSelected(t)}
                className={`flex min-h-11 cursor-pointer flex-col items-start gap-1.5 rounded-card border bg-white p-4 text-left shadow-card ${active ? 'border-brand ring-2 ring-brand' : 'border-line hover:bg-surface'}`}
              >
                <span className="flex items-center gap-2 font-semibold"><ChartBar size={18} aria-hidden />{REPORT_TYPE[t].label}</span>
                <span className="text-sm text-muted text-pretty">{REPORT_DESCRIPTION[t]}</span>
                <span className="rounded-full bg-tint px-2 py-0.5 text-xs font-semibold text-brand">Prévia</span>
              </button>
            );
          })}
        </div>
      </section>
      {selected && <ReportForm key={selected} type={selected} />}
    </PageHeader>
  );
}

function ReportForm({ type }: { type: ReportType }) {
  const { establishment } = useSession();
  const clock = useClock();
  const today = todayCivil(clock);
  const establishmentId = establishmentParam(establishment);
  const departments = useApiQuery(
    'org',
    { departments: true, establishmentId: establishmentId ?? null },
    (api, signal) => api.org.departments(establishmentId ?? '', signal),
    { enabled: establishmentId !== undefined },
  );
  const form = useZodForm(reportFormSchema, { departmentId: 'all', from: `${monthOf(today)}-01`, to: today, format: 'pdf' });
  const { register, control, formState: { errors }, watch, trigger } = form;

  // Valida a cada mudança: a prévia não envia, então o erro tem de aparecer ao digitar.
  useEffect(() => {
    const sub = watch(() => void trigger());
    return () => sub.unsubscribe();
  }, [watch, trigger]);

  const options = [
    { value: 'all', label: COPY.allDepartments },
    ...(departments.data ?? []).map((d) => ({ value: d.id, label: d.name })),
  ];
  const label = REPORT_TYPE[type].label;

  return (
    <Card as="section" className="flex flex-col gap-4 p-6">
      <h2 className="m-0 text-md font-bold tracking-[-0.01em]">Pedido: {label}</h2>
      <form noValidate onSubmit={(e) => e.preventDefault()} aria-label={`Pedido de relatório de ${label}`} className="flex flex-col gap-4">
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
          <TextInput label="Estabelecimento" value={establishment.name} readOnly hint="Vem do menu lateral." />
          <Controller
            control={control}
            name="departmentId"
            render={({ field }) => (
              <SelectField
                label="Setor"
                value={field.value}
                onValueChange={field.onChange}
                options={options}
                disabled={establishmentId === undefined}
                hint={establishmentId === undefined ? COPY.departmentNeedsEstablishment : 'Opcional.'}
              />
            )}
          />
          <DateInput label="De" required {...register('from')} error={errors.from?.message} />
          <DateInput label="Até" required {...register('to')} error={errors.to?.message} />
          <Controller
            control={control}
            name="format"
            render={({ field }) => (
              <SelectField label="Formato" value={field.value} onValueChange={field.onChange} options={FORMATS} error={errors.format?.message} />
            )}
          />
        </div>
        <div>
          <PendingBackTooltip text={COPY.generatePending}>
            <Button type="submit" variant="primary" disabled>{COPY.generate}</Button>
          </PendingBackTooltip>
        </div>
      </form>
    </Card>
  );
}
