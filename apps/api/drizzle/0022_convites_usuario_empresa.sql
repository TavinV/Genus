ALTER TABLE "rh"."convites_usuario" ADD COLUMN "empresa_id" bigint;--> statement-breakpoint
ALTER TABLE "rh"."convites_usuario" ADD CONSTRAINT "fk_convites_usuario_empresa" FOREIGN KEY ("conta_id","empresa_id") REFERENCES "rh"."empresas"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- A empresa do convite também é o que ele concede: congela junto com conta, e-mail e papel (regra da 0017).
CREATE OR REPLACE FUNCTION rh.fn_convite_usuario_regras() RETURNS trigger
LANGUAGE plpgsql
SET search_path = rh, public
AS $$
BEGIN
    IF OLD.status <> 'pendente' THEN
        RAISE EXCEPTION 'Convite encerrado não pode ser alterado'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF ROW(NEW.conta_id, NEW.email, NEW.nome, NEW.papel, NEW.empresa_id, NEW.cpf_hash, NEW.token_hash, NEW.expira_em, NEW.criado_por_id, NEW.criado_em)
       IS DISTINCT FROM
       ROW(OLD.conta_id, OLD.email, OLD.nome, OLD.papel, OLD.empresa_id, OLD.cpf_hash, OLD.token_hash, OLD.expira_em, OLD.criado_por_id, OLD.criado_em)
       OR NEW.tentativas < OLD.tentativas THEN
        RAISE EXCEPTION 'Os dados do convite não podem ser alterados'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.atualizado_em := now();
    RETURN NEW;
END;
$$;
--> statement-breakpoint

COMMENT ON COLUMN rh.convites_usuario.empresa_id IS
  'Empresa do convite: no aceite, o usuário fica restrito aos estabelecimentos dela (usuarios_estabelecimentos). NULL = conta inteira.';
