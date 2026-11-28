import { render, screen } from '@testing-library/react';
import { Tray } from '@phosphor-icons/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { mockOverview } from '@/lib/api/mocks';
import { AlertCard } from './AlertCard';
import { Button } from './Button';
import { KpiCard } from './KpiCard';
import { EmptyState, ErrorState, ForbiddenState } from './States';

describe('componentes base', () => {
  it.each(['primary', 'secondary', 'ghost'] as const)('botão %s', (variant) => {
    render(<Button variant={variant}>Aprovar</Button>);
    expect(screen.getByRole('button', { name: 'Aprovar' })).toBeInTheDocument();
  });
  it('KPI mostra valor, unidade e variação com rótulo', () => {
    const kpi = mockOverview.kpis[0]!;
    render(<KpiCard kpi={kpi} />);
    expect(screen.getByText(kpi.value)).toBeInTheDocument();
    expect(screen.getByText(kpi.unit)).toBeInTheDocument();
    expect(screen.getByLabelText('Alta')).toBeInTheDocument();
  });
  it('alerta e sinal têm ícone e texto', () => {
    render(<><AlertCard alert={mockOverview.alerts[0]!} /><AlertCard alert={mockOverview.alerts[2]!} /></>);
    expect(screen.getByText('Alerta')).toBeInTheDocument();
    expect(screen.getByText('Sinal')).toBeInTheDocument();
  });
  it('estados vazio, erro e sem permissão sem violações de acessibilidade', async () => {
    const { container } = render(<>
      <EmptyState icon={Tray} title="Fila vazia" text="Nada por aqui." />
      <ErrorState what="a fila" code="Erro 503" onRetry={() => {}} />
      <ForbiddenState screen="Atestados" />
    </>);
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar a fila');
    expect(screen.getByText('ACESSO RESTRITO')).toBeInTheDocument();
    expect(screen.getByText(/não permite abrir “Atestados”/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
