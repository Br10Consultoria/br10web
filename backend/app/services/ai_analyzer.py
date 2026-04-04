"""
BR10 NetManager - AI Analyzer Service
Serviço de análise de logs e outputs de rede via LLM.
Suporta OpenAI (GPT-4o/GPT-4.1), Google Gemini e Anthropic Claude.
"""
import logging
import time
from typing import Dict, Optional, Tuple

logger = logging.getLogger(__name__)

# ─── Prompts de sistema por tipo de análise ───────────────────────────────────

SYSTEM_PROMPTS = {
    "alarms": """Você é um especialista em redes de telecomunicações com foco em análise de alarmes.
Analise o log/alarme fornecido e:
1. Identifique os alarmes críticos e de alta severidade
2. Explique o que cada alarme significa em linguagem clara
3. Indique possíveis causas raiz
4. Sugira ações corretivas prioritárias
5. Destaque se há padrões repetitivos que indicam problema sistêmico
Responda em português brasileiro de forma objetiva e técnica.""",

    "bgp": """Você é um especialista em roteamento BGP.
Analise o output BGP fornecido e:
1. Liste todas as sessões e seus estados (Established/Idle/Active/Connect)
2. Identifique sessões caídas ou com problemas
3. Verifique prefixos recebidos/enviados e se estão dentro do esperado
4. Aponte possíveis problemas de roteamento ou filtros
5. Sugira verificações adicionais se necessário
Responda em português brasileiro de forma objetiva e técnica.""",

    "olt": """Você é um especialista em redes PON/GPON e equipamentos OLT.
Analise o output da OLT fornecido e:
1. Identifique ONUs com problemas (offline, baixo sinal óptico, erros)
2. Verifique níveis de potência óptica (Rx/Tx) e sinalize valores fora do padrão
3. Identifique alarmes de fibra ou splitter
4. Liste ONUs que precisam de atenção imediata
5. Sugira ações de manutenção preventiva
Responda em português brasileiro de forma objetiva e técnica.""",

    "system_log": """Você é um especialista em análise de logs de sistemas de rede.
Analise o log fornecido e:
1. Identifique eventos críticos ou de erro
2. Detecte padrões anômalos (loops, flaps, reconexões frequentes)
3. Verifique eventos de segurança (tentativas de acesso, mudanças de configuração)
4. Aponte problemas de performance (CPU alta, memória, interface errors)
5. Forneça um resumo executivo do estado do equipamento
Responda em português brasileiro de forma objetiva e técnica.""",

    "interfaces": """Você é um especialista em análise de interfaces de rede.
Analise o output de interfaces fornecido e:
1. Identifique interfaces com erros (input/output errors, CRC, drops)
2. Verifique interfaces down que deveriam estar up
3. Analise utilização de banda (se disponível)
4. Identifique interfaces com flapping
5. Sugira ações corretivas
Responda em português brasileiro de forma objetiva e técnica.""",

    "routing": """Você é um especialista em tabelas de roteamento.
Analise a tabela de rotas fornecida e:
1. Verifique se as rotas principais estão presentes
2. Identifique rotas duplicadas ou conflitantes
3. Analise métricas e preferências de rota
4. Detecte rotas que possam causar loops ou black holes
5. Sugira otimizações se necessário
Responda em português brasileiro de forma objetiva e técnica.""",

    "backup": """Você é um especialista em análise de configurações de rede.
Analise o arquivo de configuração/backup fornecido e:
1. Identifique configurações de segurança ausentes ou inadequadas
2. Verifique consistência das configurações de interfaces e protocolos
3. Aponte configurações que podem causar problemas de performance
4. Identifique senhas ou chaves em texto claro
5. Sugira melhorias de configuração
Responda em português brasileiro de forma objetiva e técnica.""",

    "custom": """Você é um especialista em redes de telecomunicações.
Analise o conteúdo fornecido e forneça:
1. Um resumo do que foi encontrado
2. Pontos de atenção ou problemas identificados
3. Recomendações de ação
Responda em português brasileiro de forma objetiva e técnica.""",
}

# Modelos disponíveis por provider
PROVIDER_MODELS = {
    "openai": {
        "display_name": "OpenAI",
        "models": ["gpt-4o", "gpt-4.1", "gpt-4.1-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
        "default_model": "gpt-4o",
        "base_url": None,  # usa padrão OpenAI
    },
    "gemini": {
        "display_name": "Google Gemini",
        "models": ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
        "default_model": "gemini-2.5-flash",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
    },
    "anthropic": {
        "display_name": "Anthropic Claude",
        "models": ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"],
        "default_model": "claude-3-5-sonnet-20241022",
        "base_url": "https://api.anthropic.com/v1/",
    },
}

# Limite de tokens de entrada (para não exceder limites dos modelos)
MAX_INPUT_CHARS = 50_000  # ~12.500 tokens


def truncate_input(text: str, max_chars: int = MAX_INPUT_CHARS) -> Tuple[str, bool]:
    """Trunca o texto se for muito longo, retornando (texto, foi_truncado)."""
    if len(text) <= max_chars:
        return text, False
    truncated = text[:max_chars]
    truncated += f"\n\n[... CONTEÚDO TRUNCADO - {len(text) - max_chars} caracteres omitidos para caber no limite do modelo ...]"
    return truncated, True


async def analyze_with_ai(
    content: str,
    analysis_type: str,
    provider: str,
    model: str,
    api_key: str,
    custom_prompt: Optional[str] = None,
    max_tokens: int = 4096,
    temperature: float = 0.3,
    context: Optional[str] = None,
) -> Tuple[bool, str, int, int]:
    """
    Analisa conteúdo usando o provider de IA especificado.

    Args:
        content: Texto a ser analisado (log, output de comando, etc.)
        analysis_type: Tipo de análise (alarms, bgp, olt, system_log, etc.)
        provider: Provider de IA (openai, gemini, anthropic)
        model: Modelo a usar
        api_key: Chave de API
        custom_prompt: Prompt personalizado (sobrescreve o padrão)
        max_tokens: Máximo de tokens na resposta
        temperature: Temperatura do modelo (0.0-1.0)
        context: Contexto adicional (nome do dispositivo, cliente, etc.)

    Returns:
        Tuple[sucesso, resultado, tokens_entrada, tokens_saida]
    """
    try:
        from openai import AsyncOpenAI

        # Truncar input se necessário
        content_truncated, was_truncated = truncate_input(content)

        # Construir prompt
        system_prompt = custom_prompt or SYSTEM_PROMPTS.get(analysis_type, SYSTEM_PROMPTS["custom"])

        # Adicionar contexto se fornecido
        user_message = content_truncated
        if context:
            user_message = f"Contexto: {context}\n\n---\n\n{content_truncated}"
        if was_truncated:
            user_message += "\n\n[Nota: O conteúdo foi truncado por ser muito extenso.]"

        # Configurar cliente baseado no provider
        provider_info = PROVIDER_MODELS.get(provider, PROVIDER_MODELS["openai"])
        base_url = provider_info.get("base_url")

        client_kwargs = {"api_key": api_key}
        if base_url:
            client_kwargs["base_url"] = base_url

        client = AsyncOpenAI(**client_kwargs)

        start = time.time()
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            max_tokens=max_tokens,
            temperature=temperature,
        )
        duration_ms = int((time.time() - start) * 1000)

        result_text = response.choices[0].message.content or ""
        tokens_in = response.usage.prompt_tokens if response.usage else 0
        tokens_out = response.usage.completion_tokens if response.usage else 0

        logger.info(
            f"[AI] {provider}/{model} — {tokens_in}+{tokens_out} tokens — {duration_ms}ms"
        )

        return True, result_text, tokens_in + tokens_out, duration_ms

    except ImportError:
        return False, "Biblioteca 'openai' não instalada no servidor.", 0, 0
    except Exception as e:
        logger.error(f"[AI] Erro ao analisar com {provider}/{model}: {e}")
        error_msg = str(e)
        # Mensagens de erro mais amigáveis
        if "401" in error_msg or "Unauthorized" in error_msg or "invalid_api_key" in error_msg:
            error_msg = "Chave de API inválida ou sem permissão."
        elif "429" in error_msg or "rate_limit" in error_msg:
            error_msg = "Limite de requisições atingido. Aguarde alguns segundos e tente novamente."
        elif "quota" in error_msg.lower():
            error_msg = "Cota de uso da API esgotada. Verifique seu plano no provider."
        elif "model" in error_msg.lower() and "not found" in error_msg.lower():
            error_msg = f"Modelo '{model}' não encontrado ou sem acesso. Tente outro modelo."
        return False, error_msg, 0, 0
