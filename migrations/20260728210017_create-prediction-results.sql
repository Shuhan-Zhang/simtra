CREATE TABLE public.prediction_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    city TEXT NOT NULL,
    question TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    framing TEXT NOT NULL CHECK (framing IN ('vote', 'belief', 'options')),
    as_of_date DATE NOT NULL,
    model TEXT NOT NULL,
    population TEXT NOT NULL DEFAULT 'all',
    p_yes DOUBLE PRECISION NOT NULL CHECK (p_yes >= 0 AND p_yes <= 1),
    ci_low DOUBLE PRECISION NOT NULL CHECK (ci_low >= 0 AND ci_low <= 1),
    ci_high DOUBLE PRECISION NOT NULL CHECK (ci_high >= 0 AND ci_high <= 1),
    n_agents INTEGER NOT NULL CHECK (n_agents >= 0),
    n_eff DOUBLE PRECISION NOT NULL CHECK (n_eff >= 0),
    design_effect DOUBLE PRECISION NOT NULL CHECK (design_effect >= 0),
    n_archetypes INTEGER NOT NULL CHECK (n_archetypes >= 0),
    n_llm_calls INTEGER NOT NULL CHECK (n_llm_calls >= 0),
    p_distribution JSONB NOT NULL DEFAULT '[]'::jsonb,
    breakdowns JSONB NOT NULL DEFAULT '{}'::jsonb,
    sample_rationales JSONB NOT NULL DEFAULT '[]'::jsonb,
    hydra_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    simulation_id TEXT,
    branch_id TEXT
);

ALTER TABLE public.prediction_results ENABLE ROW LEVEL SECURITY;

CREATE INDEX prediction_results_created_at_idx
    ON public.prediction_results (created_at DESC);

CREATE INDEX prediction_results_city_created_at_idx
    ON public.prediction_results (city, created_at DESC);

GRANT USAGE ON SCHEMA public TO project_admin;
GRANT SELECT, INSERT ON public.prediction_results TO project_admin;
