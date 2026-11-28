ALTER TABLE "rh"."convites_usuario" DROP CONSTRAINT "ck_convites_usuario_papel";--> statement-breakpoint
ALTER TABLE "rh"."convites_usuario" ADD COLUMN "colaborador_id" bigint;--> statement-breakpoint
ALTER TABLE "rh"."convites_usuario" ADD CONSTRAINT "fk_convites_usuario_colaborador" FOREIGN KEY ("conta_id","colaborador_id") REFERENCES "rh"."colaboradores"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_convites_usuario_colaborador" ON "rh"."convites_usuario" USING btree ("conta_id","colaborador_id") WHERE colaborador_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "rh"."convites_usuario" ADD CONSTRAINT "ck_convites_usuario_colaborador" CHECK ((papel = 'colaborador') = (colaborador_id IS NOT NULL) AND (papel <> 'colaborador' OR empresa_id IS NULL));--> statement-breakpoint
ALTER TABLE "rh"."convites_usuario" ADD CONSTRAINT "ck_convites_usuario_papel" CHECK (papel IN ('admin','rh','colaborador'));--> statement-breakpoint

-- O colaborador do convite também é o que ele concede: congela junto com conta, papel e empresa (0017 e 0022).
CREATE OR REPLACE FUNCTION rh.fn_convite_usuario_regras() RETURNS trigger
LANGUAGE plpgsql
SET search_path = rh, public
AS $$
BEGIN
    IF OLD.status <> 'pendente' THEN
        RAISE EXCEPTION 'Convite encerrado não pode ser alterado'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF ROW(NEW.conta_id, NEW.email, NEW.nome, NEW.papel, NEW.empresa_id, NEW.colaborador_id, NEW.cpf_hash, NEW.token_hash, NEW.expira_em, NEW.criado_por_id, NEW.criado_em)
       IS DISTINCT FROM
       ROW(OLD.conta_id, OLD.email, OLD.nome, OLD.papel, OLD.empresa_id, OLD.colaborador_id, OLD.cpf_hash, OLD.token_hash, OLD.expira_em, OLD.criado_por_id, OLD.criado_em)
       OR NEW.tentativas < OLD.tentativas THEN
        RAISE EXCEPTION 'Os dados do convite não podem ser alterados'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.atualizado_em := now();
    RETURN NEW;
END;
$$;
--> statement-breakpoint

COMMENT ON TABLE rh.convites_usuario IS
  'Convite de uso único: cria usuário admin ou rh da própria conta, ou o acesso de um colaborador já cadastrado ao portal. Token e CPF nunca são gravados em claro.';
--> statement-breakpoint

COMMENT ON COLUMN rh.convites_usuario.colaborador_id IS
  'Colaborador do convite de acesso ao portal (/me). O CPF conferido no aceite é o do cadastro.';
