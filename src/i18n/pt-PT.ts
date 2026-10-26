/**
 * Textos da interface em português europeu (idioma base).
 * Para acrescentar um idioma: copiar este ficheiro (ex.: pt-BR.ts), traduzir
 * e registá-lo em src/i18n/index.ts. O tipo `Dictionary` garante que nenhuma
 * chave fica em falta.
 */
export const ptPT = {
  roles: {
    org_admin: "Administrador",
    lawyer: "Advogado",
    legal_assistant: "Assistente jurídico",
    marketing_manager: "Gestor de marketing",
    viewer: "Consulta",
  },
  roleDescriptions: {
    org_admin: "Acesso total, incluindo equipa, faturação e definições.",
    lawyer: "Atendimento, contactos, agenda e aprovação de conteúdos jurídicos.",
    legal_assistant: "Atendimento, contactos e agenda. Não aprova conteúdos jurídicos.",
    marketing_manager: "Campanhas e relatórios. Não vê conversas nem contactos individuais.",
    viewer: "Consulta de relatórios e agenda, sem alterações.",
  },
  memberStatus: {
    active: "Ativo",
    suspended: "Suspenso",
  },
  nav: {
    dashboard: "Dashboard",
    whatsapp: "WhatsApp IA",
    inbox: "Caixa de entrada",
    contacts: "Contactos e CRM",
    calendar: "Agenda",
    knowledge: "Base jurídica",
    ads: "Tráfego Pago IA",
    campaigns: "Campanhas",
    reports: "Relatórios",
    team: "Equipa",
    billing: "Faturação",
    settings: "Configurações",
  },
  errors: {
    generic: "Não foi possível concluir a operação. Tente novamente.",
    not_authenticated: "A sua sessão terminou. Entre novamente.",
    forbidden: "Não tem permissão para esta ação.",
    not_found: "O registo já não existe.",
    slug_taken: "Esse endereço já está a ser usado por outro escritório. Escolha outro.",
    organization_limit_reached: "Atingiu o limite de escritórios que pode criar. Contacte o suporte.",
    invalid_email: "Indique um email válido.",
    already_member: "Essa pessoa já faz parte da equipa.",
    invitation_invalid: "Este convite já foi usado ou foi cancelado.",
    invitation_expired: "Este convite expirou. Peça um novo ao administrador do escritório.",
    invitation_email_mismatch:
      "Este convite foi enviado para outro email. Entre com a conta desse email para o aceitar.",
    last_admin: "O escritório precisa de pelo menos um administrador ativo.",
    consent_required: "Precisa de aceitar o tratamento dos dados para o pedido.",
    invalid_credentials: "Email ou palavra-passe incorretos.",
    email_not_confirmed: "Confirme o seu email antes de entrar. Verifique a caixa de correio.",
    weak_password: "A palavra-passe é demasiado fraca.",
    user_already_exists: "Já existe uma conta com este email. Entre ou recupere a palavra-passe.",
    rate_limited: "Demasiadas tentativas. Aguarde alguns minutos e tente de novo.",
    mfa_invalid_code: "Código incorreto ou expirado. Confirme a hora do telemóvel e tente de novo.",
    not_configured:
      "A autenticação ainda não está configurada neste ambiente. Defina as variáveis do Supabase (ver README).",
  },
} as const;

type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> };
export type Dictionary = Widen<typeof ptPT>;
