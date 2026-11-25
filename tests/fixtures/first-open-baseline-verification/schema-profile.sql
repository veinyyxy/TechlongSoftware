-- PostgreSQL database dump

SET statement_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;

--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;

--
-- Name: default_saas_instance_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.default_saas_instance_id() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  SELECT instance_id
  FROM public.saas_instances
  WHERE singleton_key = TRUE
  LIMIT 1
$$;

--
-- Name: default_store_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.default_store_id() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  SELECT store_id
  FROM public.stores
  ORDER BY
    (status = 'active' AND is_default = TRUE) DESC,
    (status = 'active') DESC,
    is_default DESC,
    created_at,
    store_id
  LIMIT 1
$$;

--
-- Name: refresh_cart_subtotal(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_cart_subtotal(target_cart_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE public.cart
  SET subtotal_snapshot = COALESCE((
    SELECT SUM(line_subtotal)
    FROM public.cartitem
    WHERE cart_id = target_cart_id
  ), 0)
  WHERE cart_id = target_cart_id;
END;
$$;

--
-- Name: refresh_cart_subtotal_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_cart_subtotal_trigger() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_cart_subtotal(OLD.cart_id);
    RETURN OLD;
  END IF;

  PERFORM public.refresh_cart_subtotal(NEW.cart_id);
  IF TG_OP = 'UPDATE' AND OLD.cart_id <> NEW.cart_id THEN
    PERFORM public.refresh_cart_subtotal(OLD.cart_id);
  END IF;
  RETURN NEW;
END;
$$;

--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: cart; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cart (
  cart_id uuid NOT NULL,
  subtotal_snapshot numeric,
  updated_at timestamp with time zone
);

--
-- Name: cartitem; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cartitem (
  cart_id uuid NOT NULL,
  line_subtotal numeric,
  updated_at timestamp with time zone
);

--
-- Name: saas_instances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saas_instances (
  instance_id uuid NOT NULL,
  singleton_key boolean
);

--
-- Name: stores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stores (
  store_id uuid NOT NULL,
  status text,
  is_default boolean,
  created_at timestamp with time zone
);

--
-- Name: system_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_config (
  updated_at timestamp with time zone
);

--
-- Name: cart trg_cart_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cart_set_updated_at BEFORE UPDATE ON public.cart FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

--
-- Name: cartitem trg_cartitem_refresh_cart_subtotal; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cartitem_refresh_cart_subtotal AFTER INSERT OR DELETE OR UPDATE ON public.cartitem FOR EACH ROW EXECUTE FUNCTION public.refresh_cart_subtotal_trigger();

--
-- Name: cartitem trg_cartitem_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cartitem_set_updated_at BEFORE UPDATE ON public.cartitem FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

--
-- Name: system_config trg_system_config_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_system_config_set_updated_at BEFORE UPDATE ON public.system_config FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
