import { pgTable, uniqueIndex, index, text, bigint, foreignKey, check, integer } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const products = pgTable("products", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	slug: text().notNull(),
	description: text().default('').notNull(),
	status: text().default('active').notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	createdAt: bigint("created_at", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => [
	uniqueIndex("products_slug_unique").using("btree", table.slug.asc().nullsLast().op("text_ops")),
	index("products_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
]);

export const appInstanceTemplates = pgTable("app_instance_templates", {
	id: text().primaryKey().notNull(),
	productId: text("product_id").notNull(),
	name: text().notNull(),
	description: text().default('').notNull(),
	status: text().default('active').notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	createdAt: bigint("created_at", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => [
	index("app_instance_templates_product_id_idx").using("btree", table.productId.asc().nullsLast().op("text_ops")),
	uniqueIndex("app_instance_templates_product_name_unique").using("btree", table.productId.asc().nullsLast().op("text_ops"), table.name.asc().nullsLast().op("text_ops")),
	index("app_instance_templates_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [products.id],
			name: "app_instance_templates_product_id_fkey"
		}).onDelete("restrict"),
]);

export const appInstanceTemplateVersions = pgTable("app_instance_template_versions", {
	id: text().primaryKey().notNull(),
	templateId: text("template_id").notNull(),
	version: integer().notNull(),
	configurationSchema: text("configuration_schema").default('{"fields":[]}').notNull(),
	defaultConfiguration: text("default_configuration").default('{}').notNull(),
	deploymentDriver: text("deployment_driver").default('manual').notNull(),
	deploymentWorkflowVersion: text("deployment_workflow_version").default('v1').notNull(),
	status: text().default('draft').notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	createdAt: bigint("created_at", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => [
	index("app_instance_template_versions_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("app_instance_template_versions_template_id_idx").using("btree", table.templateId.asc().nullsLast().op("text_ops")),
	uniqueIndex("app_instance_template_versions_template_version_unique").using("btree", table.templateId.asc().nullsLast().op("text_ops"), table.version.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.templateId],
			foreignColumns: [appInstanceTemplates.id],
			name: "app_instance_template_versions_template_id_fkey"
		}).onDelete("restrict"),
	check("app_instance_template_versions_configuration_schema_check", sql`jsonb_typeof((configuration_schema)::jsonb) = 'object'::text`),
	check("app_instance_template_versions_default_configuration_check", sql`jsonb_typeof((default_configuration)::jsonb) = 'object'::text`),
]);

export const plans = pgTable("plans", {
	id: text().primaryKey().notNull(),
	productId: text("product_id").notNull(),
	templateVersionId: text("template_version_id").notNull(),
	name: text().notNull(),
	description: text().default('').notNull(),
	priceAmount: integer("price_amount").notNull(),
	currency: text().notNull(),
	billingInterval: text("billing_interval").notNull(),
	deploymentProfileKey: text("deployment_profile_key").default('standard-v1').notNull(),
	status: text().default('active').notNull(),
	features: text().default('[]').notNull(),
	limits: text().default('{}').notNull(),
	templateConfiguration: text("template_configuration").default('{}').notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	createdAt: bigint("created_at", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => [
	index("plans_product_id_idx").using("btree", table.productId.asc().nullsLast().op("text_ops")),
	uniqueIndex("plans_product_name_unique").using("btree", table.productId.asc().nullsLast().op("text_ops"), table.name.asc().nullsLast().op("text_ops")),
	index("plans_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [products.id],
			name: "plans_product_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.templateVersionId],
			foreignColumns: [appInstanceTemplateVersions.id],
			name: "plans_template_version_id_fkey"
		}).onDelete("restrict"),
	check("plans_template_configuration_check", sql`jsonb_typeof((template_configuration)::jsonb) = 'object'::text`),
	check("plans_deployment_profile_check", sql`deployment_profile_key = ANY (ARRAY['standard-v1'::text, 'large-v1'::text, 'large-dedicated-db-v1'::text])`),
]);

export const users = pgTable("users", {
	id: text().primaryKey().notNull(),
	email: text().notNull(),
	name: text().notNull(),
	status: text().default('active').notNull(),
	isPlatformAdmin: integer("is_platform_admin").default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	createdAt: bigint("created_at", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => [
	uniqueIndex("users_email_unique").using("btree", table.email.asc().nullsLast().op("text_ops")),
	index("users_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
]);

export const userCredentials = pgTable("user_credentials", {
	userId: text("user_id").primaryKey().notNull(),
	passwordHash: text("password_hash").notNull(),
	passwordSalt: text("password_salt").notNull(),
	passwordIterations: integer("password_iterations").notNull(),
	failedAttempts: integer("failed_attempts").default(0).notNull(),
	lockedUntil: bigint("locked_until", { mode: "number" }),
	passwordChangedAt: bigint("password_changed_at", { mode: "number" }).notNull(),
	createdAt: bigint("created_at", { mode: "number" }).notNull(),
	updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => [
	index("user_credentials_locked_until_idx").using("btree", table.lockedUntil.asc().nullsLast().op("int8_ops")),
	foreignKey({
		columns: [table.userId],
		foreignColumns: [users.id],
		name: "user_credentials_user_id_fkey"
	}).onDelete("cascade"),
]);

export const authSessions = pgTable("auth_sessions", {
	id: text().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	tokenHash: text("token_hash").notNull(),
	expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
	lastSeenAt: bigint("last_seen_at", { mode: "number" }).notNull(),
	createdAt: bigint("created_at", { mode: "number" }).notNull(),
}, (table) => [
	uniqueIndex("auth_sessions_token_hash_unique").using("btree", table.tokenHash.asc().nullsLast().op("text_ops")),
	index("auth_sessions_user_id_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
	index("auth_sessions_expires_at_idx").using("btree", table.expiresAt.asc().nullsLast().op("int8_ops")),
	foreignKey({
		columns: [table.userId],
		foreignColumns: [users.id],
		name: "auth_sessions_user_id_fkey"
	}).onDelete("cascade"),
]);

export const authInvitations = pgTable("auth_invitations", {
	id: text().primaryKey().notNull(),
	userId: text("user_id").notNull(),
	tokenHash: text("token_hash").notNull(),
	expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
	acceptedAt: bigint("accepted_at", { mode: "number" }),
	createdByUserId: text("created_by_user_id").notNull(),
	createdAt: bigint("created_at", { mode: "number" }).notNull(),
}, (table) => [
	uniqueIndex("auth_invitations_token_hash_unique").using("btree", table.tokenHash.asc().nullsLast().op("text_ops")),
	index("auth_invitations_user_id_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
	index("auth_invitations_expires_at_idx").using("btree", table.expiresAt.asc().nullsLast().op("int8_ops")),
	foreignKey({
		columns: [table.userId],
		foreignColumns: [users.id],
		name: "auth_invitations_user_id_fkey"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.createdByUserId],
		foreignColumns: [users.id],
		name: "auth_invitations_created_by_user_id_fkey"
	}).onDelete("restrict"),
]);

export const workspaces = pgTable("workspaces", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	ownerId: text("owner_id").notNull(),
	status: text().default('active').notNull(),
	contactName: text("contact_name"),
	contactEmail: text("contact_email"),
	planId: text("plan_id"),
	subscriptionStatus: text("subscription_status").default('not_configured').notNull(),
	appInstanceStatus: text("app_instance_status").default('not_provisioned').notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	createdAt: bigint("created_at", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => [
	index("workspaces_owner_id_idx").using("btree", table.ownerId.asc().nullsLast().op("text_ops")),
	index("workspaces_plan_id_idx").using("btree", table.planId.asc().nullsLast().op("text_ops")),
	index("workspaces_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.ownerId],
			foreignColumns: [users.id],
			name: "workspaces_owner_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.planId],
			foreignColumns: [plans.id],
			name: "workspaces_plan_id_fkey"
		}).onDelete("set null"),
]);

export const subscriptions = pgTable("subscriptions", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull(),
	productId: text("product_id").notNull(),
	planId: text("plan_id").notNull(),
	templateVersionId: text("template_version_id").notNull(),
	instanceConfiguration: text("instance_configuration").default('{}').notNull(),
	status: text().default('manual_pending').notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	currentPeriodStart: bigint("current_period_start", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	currentPeriodEnd: bigint("current_period_end", { mode: "number" }).notNull(),
	cancelAtPeriodEnd: integer("cancel_at_period_end").default(0).notNull(),
	creationSource: text("creation_source").default('admin_manual').notNull(),
	deploymentProfileKey: text("deployment_profile_key").default('standard-v1').notNull(),
	createdByUserId: text("created_by_user_id").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	createdAt: bigint("created_at", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => [
	index("subscriptions_plan_id_idx").using("btree", table.planId.asc().nullsLast().op("text_ops")),
	index("subscriptions_product_id_idx").using("btree", table.productId.asc().nullsLast().op("text_ops")),
	index("subscriptions_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("subscriptions_template_version_id_idx").using("btree", table.templateVersionId.asc().nullsLast().op("text_ops")),
	index("subscriptions_workspace_id_idx").using("btree", table.workspaceId.asc().nullsLast().op("text_ops")),
	uniqueIndex("subscriptions_workspace_product_current_unique").using("btree", table.workspaceId.asc().nullsLast().op("text_ops"), table.productId.asc().nullsLast().op("text_ops")).where(sql`(status = ANY (ARRAY['manual_pending'::text, 'active'::text, 'past_due'::text, 'paused'::text]))`),
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "subscriptions_workspace_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [products.id],
			name: "subscriptions_product_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.planId],
			foreignColumns: [plans.id],
			name: "subscriptions_plan_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.templateVersionId],
			foreignColumns: [appInstanceTemplateVersions.id],
			name: "subscriptions_template_version_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.createdByUserId],
			foreignColumns: [users.id],
			name: "subscriptions_created_by_user_id_fkey"
		}).onDelete("restrict"),
	check("subscriptions_instance_configuration_check", sql`jsonb_typeof((instance_configuration)::jsonb) = 'object'::text`),
	check("subscriptions_deployment_profile_check", sql`deployment_profile_key = ANY (ARRAY['standard-v1'::text, 'large-v1'::text, 'large-dedicated-db-v1'::text])`),
]);

export const paymentRecords = pgTable("payment_records", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull(),
	subscriptionId: text("subscription_id"),
	amount: integer().notNull(),
	currency: text().notNull(),
	status: text().default('pending').notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	paidAt: bigint("paid_at", { mode: "number" }),
	paymentMethod: text("payment_method").notNull(),
	provider: text().default('manual').notNull(),
	providerPaymentId: text("provider_payment_id"),
	providerEventId: text("provider_event_id"),
	reference: text(),
	note: text(),
	failureReason: text("failure_reason"),
	recordedByUserId: text("recorded_by_user_id").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	createdAt: bigint("created_at", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => [
	uniqueIndex("payment_records_provider_event_id_unique").using("btree", table.provider.asc().nullsLast().op("text_ops"), table.providerEventId.asc().nullsLast().op("text_ops")),
	uniqueIndex("payment_records_provider_payment_id_unique").using("btree", table.provider.asc().nullsLast().op("text_ops"), table.providerPaymentId.asc().nullsLast().op("text_ops")),
	index("payment_records_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("payment_records_subscription_id_idx").using("btree", table.subscriptionId.asc().nullsLast().op("text_ops")),
	index("payment_records_workspace_id_idx").using("btree", table.workspaceId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "payment_records_workspace_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.subscriptionId],
			foreignColumns: [subscriptions.id],
			name: "payment_records_subscription_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.recordedByUserId],
			foreignColumns: [users.id],
			name: "payment_records_recorded_by_user_id_fkey"
		}).onDelete("restrict"),
]);

export const paymentCheckoutSessions = pgTable("payment_checkout_sessions", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull(),
	subscriptionId: text("subscription_id").notNull(),
	planId: text("plan_id").notNull(),
	paymentRecordId: text("payment_record_id").notNull(),
	initiatedByUserId: text("initiated_by_user_id").notNull(),
	provider: text().default('stripe').notNull(),
	providerSessionId: text("provider_session_id"),
	providerPaymentId: text("provider_payment_id"),
	checkoutUrl: text("checkout_url"),
	status: text().default('creating').notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	expiresAt: bigint("expires_at", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	completedAt: bigint("completed_at", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	createdAt: bigint("created_at", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => [
	index("payment_checkout_sessions_payment_record_id_idx").using("btree", table.paymentRecordId.asc().nullsLast().op("text_ops")),
	uniqueIndex("payment_checkout_sessions_provider_session_unique").using("btree", table.provider.asc().nullsLast().op("text_ops"), table.providerSessionId.asc().nullsLast().op("text_ops")),
	index("payment_checkout_sessions_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("payment_checkout_sessions_subscription_id_idx").using("btree", table.subscriptionId.asc().nullsLast().op("text_ops")),
	uniqueIndex("payment_checkout_sessions_subscription_inflight_unique").using("btree", table.subscriptionId.asc().nullsLast().op("text_ops")).where(sql`(status = ANY (ARRAY['creating'::text, 'open'::text]))`),
	index("payment_checkout_sessions_workspace_id_idx").using("btree", table.workspaceId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "payment_checkout_sessions_workspace_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.subscriptionId],
			foreignColumns: [subscriptions.id],
			name: "payment_checkout_sessions_subscription_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.planId],
			foreignColumns: [plans.id],
			name: "payment_checkout_sessions_plan_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.paymentRecordId],
			foreignColumns: [paymentRecords.id],
			name: "payment_checkout_sessions_payment_record_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.initiatedByUserId],
			foreignColumns: [users.id],
			name: "payment_checkout_sessions_initiated_by_user_id_fkey"
		}).onDelete("restrict"),
]);

export const appInstances = pgTable("app_instances", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull(),
	productId: text("product_id").notNull(),
	subscriptionId: text("subscription_id"),
	templateVersionId: text("template_version_id"),
	configurationSnapshot: text("configuration_snapshot").default('{}').notNull(),
	name: text().notNull(),
	slug: text().notNull(),
	domain: text(),
	accessUrl: text("access_url").notNull(),
	sellerApkUrl: text("seller_apk_url").default('').notNull(),
	tenantKey: text("tenant_key").notNull(),
	provisioningSource: text("provisioning_source").default('manual').notNull(),
	status: text().default('pending').notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	provisionedAt: bigint("provisioned_at", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	suspendedAt: bigint("suspended_at", { mode: "number" }),
	createdByUserId: text("created_by_user_id").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	createdAt: bigint("created_at", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => [
	index("app_instances_product_id_idx").using("btree", table.productId.asc().nullsLast().op("text_ops")),
	uniqueIndex("app_instances_slug_unique").using("btree", table.slug.asc().nullsLast().op("text_ops")),
	index("app_instances_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("app_instances_subscription_id_idx").using("btree", table.subscriptionId.asc().nullsLast().op("text_ops")),
	index("app_instances_template_version_id_idx").using("btree", table.templateVersionId.asc().nullsLast().op("text_ops")),
	uniqueIndex("app_instances_tenant_key_unique").using("btree", table.tenantKey.asc().nullsLast().op("text_ops")),
	index("app_instances_workspace_id_idx").using("btree", table.workspaceId.asc().nullsLast().op("text_ops")),
	uniqueIndex("app_instances_workspace_product_unique").using("btree", table.workspaceId.asc().nullsLast().op("text_ops"), table.productId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "app_instances_workspace_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [products.id],
			name: "app_instances_product_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.subscriptionId],
			foreignColumns: [subscriptions.id],
			name: "app_instances_subscription_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.templateVersionId],
			foreignColumns: [appInstanceTemplateVersions.id],
			name: "app_instances_template_version_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.createdByUserId],
			foreignColumns: [users.id],
			name: "app_instances_created_by_user_id_fkey"
		}).onDelete("restrict"),
	check("app_instances_configuration_snapshot_check", sql`jsonb_typeof((configuration_snapshot)::jsonb) = 'object'::text`),
]);

export const subscriptionPurchaseOrders = pgTable("subscription_purchase_orders", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull(),
	productId: text("product_id").notNull(),
	planId: text("plan_id").notNull(),
	templateVersionId: text("template_version_id").notNull(),
	subscriptionId: text("subscription_id"),
	renewalSubscriptionId: text("renewal_subscription_id"),
	paymentRecordId: text("payment_record_id"),
	orderType: text("order_type").default('new_subscription').notNull(),
	configurationSnapshot: text("configuration_snapshot").default('{}').notNull(),
	amount: integer().notNull(),
	currency: text().notNull(),
	billingInterval: text("billing_interval").notNull(),
	deploymentProfileKey: text("deployment_profile_key").default('standard-v1').notNull(),
	status: text().default('draft').notNull(),
	provider: text().default('stripe').notNull(),
	providerSessionId: text("provider_session_id"),
	providerPaymentId: text("provider_payment_id"),
	checkoutUrl: text("checkout_url"),
	failureReason: text("failure_reason"),
	createdByUserId: text("created_by_user_id").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	expiresAt: bigint("expires_at", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	completedAt: bigint("completed_at", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	createdAt: bigint("created_at", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => [
	index("subscription_purchase_orders_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("int8_ops")),
	index("subscription_purchase_orders_plan_id_idx").using("btree", table.planId.asc().nullsLast().op("text_ops")),
	index("subscription_purchase_orders_product_id_idx").using("btree", table.productId.asc().nullsLast().op("text_ops")),
	uniqueIndex("subscription_purchase_orders_provider_session_unique").using("btree", table.provider.asc().nullsLast().op("text_ops"), table.providerSessionId.asc().nullsLast().op("text_ops")),
	index("subscription_purchase_orders_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	uniqueIndex("subscription_purchase_orders_subscription_unique").using("btree", table.subscriptionId.asc().nullsLast().op("text_ops")),
	index("subscription_purchase_orders_workspace_id_idx").using("btree", table.workspaceId.asc().nullsLast().op("text_ops")),
	uniqueIndex("subscription_purchase_orders_workspace_product_inflight_unique").using("btree", table.workspaceId.asc().nullsLast().op("text_ops"), table.productId.asc().nullsLast().op("text_ops")).where(sql`(status = ANY (ARRAY['draft'::text, 'checkout_pending'::text]))`),
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "subscription_purchase_orders_workspace_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [products.id],
			name: "subscription_purchase_orders_product_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.planId],
			foreignColumns: [plans.id],
			name: "subscription_purchase_orders_plan_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.templateVersionId],
			foreignColumns: [appInstanceTemplateVersions.id],
			name: "subscription_purchase_orders_template_version_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.subscriptionId],
			foreignColumns: [subscriptions.id],
			name: "subscription_purchase_orders_subscription_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.renewalSubscriptionId],
			foreignColumns: [subscriptions.id],
			name: "subscription_purchase_orders_renewal_subscription_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.paymentRecordId],
			foreignColumns: [paymentRecords.id],
			name: "subscription_purchase_orders_payment_record_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.createdByUserId],
			foreignColumns: [users.id],
			name: "subscription_purchase_orders_created_by_user_id_fkey"
		}).onDelete("restrict"),
	check("subscription_purchase_orders_configuration_snapshot_check", sql`jsonb_typeof((configuration_snapshot)::jsonb) = 'object'::text`),
	check("subscription_purchase_orders_deployment_profile_check", sql`deployment_profile_key = ANY (ARRAY['standard-v1'::text, 'large-v1'::text, 'large-dedicated-db-v1'::text])`),
]);

export const deploymentEnvironments = pgTable("deployment_environments", {
	id: text().primaryKey().notNull(),
	key: text().notNull(),
	name: text().notNull(),
	kind: text().notNull(),
	driver: text().notNull(),
	expectedAccountId: text("expected_account_id").notNull(),
	region: text().notNull(),
	cellKey: text("cell_key").notNull(),
	baseDomain: text("base_domain").notNull(),
	applyEnabled: integer("apply_enabled").default(0).notNull(),
	policy: text().notNull(),
	status: text().default('active').notNull(),
	createdAt: bigint("created_at", { mode: "number" }).notNull(),
	updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => [
	uniqueIndex("deployment_environments_key_unique").using("btree", table.key.asc().nullsLast().op("text_ops")),
	index("deployment_environments_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	check("deployment_environments_kind_check", sql`kind = ANY (ARRAY['aws_sandbox'::text, 'aws_production'::text])`),
	check("deployment_environments_driver_check", sql`driver = 'aws_ecs_cell'::text`),
	check("deployment_environments_account_check", sql`expected_account_id ~ '^[0-9]{12}$'::text`),
	check("deployment_environments_apply_check", sql`apply_enabled = ANY (ARRAY[0, 1])`),
	check("deployment_environments_policy_check", sql`jsonb_typeof((policy)::jsonb) = 'object'::text AND octet_length(policy) <= 16384`),
	check("deployment_environments_status_check", sql`status = ANY (ARRAY['active'::text, 'inactive'::text])`),
]);

export const appInstanceDeployments = pgTable("app_instance_deployments", {
	id: text().primaryKey().notNull(),
	appInstanceId: text("app_instance_id").notNull(),
	subscriptionId: text("subscription_id"),
	purchaseOrderId: text("purchase_order_id"),
	environmentId: text("environment_id").notNull(),
	driver: text().notNull(),
	workflowVersion: text("workflow_version").notNull(),
	cellKey: text("cell_key").notNull(),
	deploymentProfileKey: text("deployment_profile_key").notNull(),
	mode: text().default('plan_only').notNull(),
	status: text().default('planned').notNull(),
	desiredPlan: text("desired_plan").notNull(),
	planHash: text("plan_hash").notNull(),
	configurationHash: text("configuration_hash"),
	idempotencyKey: text("idempotency_key").notNull(),
	artifactRef: text("artifact_ref"),
	controlPayloadHash: text("control_payload_hash"),
	currentStep: text("current_step"),
	outputs: text().default('{}').notNull(),
	attempts: integer().default(0).notNull(),
	lastError: text("last_error"),
	startedAt: bigint("started_at", { mode: "number" }),
	readyAt: bigint("ready_at", { mode: "number" }),
	failedAt: bigint("failed_at", { mode: "number" }),
	cancelRequestedAt: bigint("cancel_requested_at", { mode: "number" }),
	rollbackAt: bigint("rollback_at", { mode: "number" }),
	createdAt: bigint("created_at", { mode: "number" }).notNull(),
	updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => [
	index("app_instance_deployments_app_instance_id_idx").using("btree", table.appInstanceId.asc().nullsLast().op("text_ops")),
	uniqueIndex("app_instance_deployments_idempotency_unique").using("btree", table.idempotencyKey.asc().nullsLast().op("text_ops")),
	index("app_instance_deployments_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("app_instance_deployments_subscription_id_idx").using("btree", table.subscriptionId.asc().nullsLast().op("text_ops")),
	index("app_instance_deployments_environment_id_idx").using("btree", table.environmentId.asc().nullsLast().op("text_ops")),
	foreignKey({
		columns: [table.appInstanceId],
		foreignColumns: [appInstances.id],
		name: "app_instance_deployments_app_instance_id_fkey"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.subscriptionId],
		foreignColumns: [subscriptions.id],
		name: "app_instance_deployments_subscription_id_fkey"
	}).onDelete("set null"),
	foreignKey({
		columns: [table.purchaseOrderId],
		foreignColumns: [subscriptionPurchaseOrders.id],
		name: "app_instance_deployments_purchase_order_id_fkey"
	}).onDelete("set null"),
	foreignKey({
		columns: [table.environmentId],
		foreignColumns: [deploymentEnvironments.id],
		name: "app_instance_deployments_environment_id_fkey"
	}).onDelete("restrict"),
	check("app_instance_deployments_profile_check", sql`deployment_profile_key = ANY (ARRAY['standard-v1'::text, 'large-v1'::text, 'large-dedicated-db-v1'::text])`),
	check("app_instance_deployments_mode_check", sql`mode = ANY (ARRAY['plan_only'::text, 'aws_sandbox'::text, 'aws_production'::text])`),
	check("app_instance_deployments_status_check", sql`status = ANY (ARRAY['planned'::text, 'queued'::text, 'preflight'::text, 'database_preparing'::text, 'migrating'::text, 'infrastructure_provisioning'::text, 'waiting_healthy'::text, 'configuring'::text, 'verifying'::text, 'ready'::text, 'retry_wait'::text, 'failed'::text, 'cancel_requested'::text, 'rolling_back'::text, 'rolled_back'::text, 'rollback_failed'::text, 'canceled'::text])`),
	check("app_instance_deployments_desired_plan_check", sql`jsonb_typeof((desired_plan)::jsonb) = 'object'::text`),
	check("app_instance_deployments_configuration_hash_check", sql`(mode = 'plan_only'::text AND configuration_hash IS NULL) OR (mode <> 'plan_only'::text AND configuration_hash IS NOT NULL AND configuration_hash ~ '^[a-f0-9]{64}$'::text)`),
	check("app_instance_deployments_control_payload_hash_check", sql`control_payload_hash IS NULL OR control_payload_hash ~ '^[a-f0-9]{64}$'::text`),
	check("app_instance_deployments_outputs_check", sql`jsonb_typeof((outputs)::jsonb) = 'object'::text AND octet_length(outputs) <= 32768`),
]);

export const deploymentJobs = pgTable("deployment_jobs", {
	id: text().primaryKey().notNull(),
	deploymentId: text("deployment_id").notNull(),
	jobType: text("job_type").notNull(),
	dedupeKey: text("dedupe_key").notNull(),
	status: text().default('pending').notNull(),
	payload: text().default('{}').notNull(),
	attempts: integer().default(0).notNull(),
	maxAttempts: integer("max_attempts").default(5).notNull(),
	availableAt: bigint("available_at", { mode: "number" }).notNull(),
	leaseOwner: text("lease_owner"),
	leaseExpiresAt: bigint("lease_expires_at", { mode: "number" }),
	lastErrorCode: text("last_error_code"),
	lastErrorMessage: text("last_error_message"),
	createdAt: bigint("created_at", { mode: "number" }).notNull(),
	updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
	completedAt: bigint("completed_at", { mode: "number" }),
}, (table) => [
	uniqueIndex("deployment_jobs_dedupe_unique").using("btree", table.dedupeKey.asc().nullsLast().op("text_ops")),
	index("deployment_jobs_claim_idx").using("btree", table.status.asc().nullsLast().op("text_ops"), table.availableAt.asc().nullsLast().op("int8_ops"), table.createdAt.asc().nullsLast().op("int8_ops")),
	index("deployment_jobs_deployment_id_idx").using("btree", table.deploymentId.asc().nullsLast().op("text_ops")),
	uniqueIndex("deployment_jobs_one_running_per_deployment").using("btree", table.deploymentId.asc().nullsLast().op("text_ops")).where(sql`status = 'running'::text`),
	index("deployment_jobs_lease_expires_at_idx").using("btree", table.leaseExpiresAt.asc().nullsLast().op("int8_ops")).where(sql`status = 'running'::text`),
	foreignKey({
		columns: [table.deploymentId],
		foreignColumns: [appInstanceDeployments.id],
		name: "deployment_jobs_deployment_id_fkey"
	}).onDelete("cascade"),
	check("deployment_jobs_type_check", sql`job_type = ANY (ARRAY['apply'::text, 'rollback'::text, 'reconcile'::text])`),
	check("deployment_jobs_status_check", sql`status = ANY (ARRAY['pending'::text, 'running'::text, 'retry_wait'::text, 'succeeded'::text, 'dead_letter'::text, 'canceled'::text])`),
	check("deployment_jobs_payload_check", sql`jsonb_typeof((payload)::jsonb) = 'object'::text AND octet_length(payload) <= 32768`),
	check("deployment_jobs_attempts_check", sql`attempts >= 0`),
	check("deployment_jobs_max_attempts_check", sql`max_attempts >= 1 AND max_attempts <= 20`),
	check("deployment_jobs_lease_check", sql`status <> 'running'::text OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)`),
]);

export const deploymentStepRuns = pgTable("deployment_step_runs", {
	id: text().primaryKey().notNull(),
	deploymentId: text("deployment_id").notNull(),
	jobId: text("job_id").notNull(),
	stepKey: text("step_key").notNull(),
	attempt: integer().notNull(),
	status: text().default('running').notNull(),
	inputHash: text("input_hash").notNull(),
	output: text().default('{}').notNull(),
	errorCode: text("error_code"),
	errorMessage: text("error_message"),
	startedAt: bigint("started_at", { mode: "number" }).notNull(),
	finishedAt: bigint("finished_at", { mode: "number" }),
}, (table) => [
	uniqueIndex("deployment_step_runs_attempt_unique").using("btree", table.deploymentId.asc().nullsLast().op("text_ops"), table.stepKey.asc().nullsLast().op("text_ops"), table.inputHash.asc().nullsLast().op("text_ops"), table.attempt.asc().nullsLast().op("int4_ops")),
	index("deployment_step_runs_deployment_id_idx").using("btree", table.deploymentId.asc().nullsLast().op("text_ops"), table.startedAt.asc().nullsLast().op("int8_ops")),
	index("deployment_step_runs_job_id_idx").using("btree", table.jobId.asc().nullsLast().op("text_ops")),
	foreignKey({
		columns: [table.deploymentId],
		foreignColumns: [appInstanceDeployments.id],
		name: "deployment_step_runs_deployment_id_fkey"
	}).onDelete("cascade"),
	foreignKey({
		columns: [table.jobId],
		foreignColumns: [deploymentJobs.id],
		name: "deployment_step_runs_job_id_fkey"
	}).onDelete("cascade"),
	check("deployment_step_runs_attempt_check", sql`attempt >= 1`),
	check("deployment_step_runs_status_check", sql`status = ANY (ARRAY['running'::text, 'succeeded'::text, 'failed'::text, 'skipped'::text])`),
	check("deployment_step_runs_input_hash_check", sql`input_hash ~ '^[a-f0-9]{64}$'::text`),
	check("deployment_step_runs_output_check", sql`jsonb_typeof((output)::jsonb) = 'object'::text AND octet_length(output) <= 32768`),
]);

export const paymentWebhookEvents = pgTable("payment_webhook_events", {
	id: text().primaryKey().notNull(),
	provider: text().notNull(),
	providerEventId: text("provider_event_id").notNull(),
	eventType: text("event_type").notNull(),
	checkoutSessionId: text("checkout_session_id"),
	purchaseOrderId: text("purchase_order_id"),
	payloadHash: text("payload_hash").notNull(),
	processingStatus: text("processing_status").default('pending').notNull(),
	lastError: text("last_error"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	receivedAt: bigint("received_at", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	processedAt: bigint("processed_at", { mode: "number" }),
}, (table) => [
	index("payment_webhook_events_checkout_session_id_idx").using("btree", table.checkoutSessionId.asc().nullsLast().op("text_ops")),
	index("payment_webhook_events_processing_status_idx").using("btree", table.processingStatus.asc().nullsLast().op("text_ops")),
	uniqueIndex("payment_webhook_events_provider_event_unique").using("btree", table.provider.asc().nullsLast().op("text_ops"), table.providerEventId.asc().nullsLast().op("text_ops")),
	index("payment_webhook_events_purchase_order_id_idx").using("btree", table.purchaseOrderId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.checkoutSessionId],
			foreignColumns: [paymentCheckoutSessions.id],
			name: "payment_webhook_events_checkout_session_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.purchaseOrderId],
			foreignColumns: [subscriptionPurchaseOrders.id],
			name: "payment_webhook_events_purchase_order_id_fkey"
		}).onDelete("set null"),
]);

export const workspaceMembers = pgTable("workspace_members", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull(),
	userId: text("user_id").notNull(),
	role: text().default('member').notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	joinedAt: bigint("joined_at", { mode: "number" }).notNull(),
}, (table) => [
	index("workspace_members_user_id_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
	index("workspace_members_workspace_id_idx").using("btree", table.workspaceId.asc().nullsLast().op("text_ops")),
	uniqueIndex("workspace_members_workspace_user_unique").using("btree", table.workspaceId.asc().nullsLast().op("text_ops"), table.userId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "workspace_members_workspace_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "workspace_members_user_id_fkey"
		}).onDelete("cascade"),
]);

export const workspaceProductEntitlements = pgTable("workspace_product_entitlements", {
	id: text().primaryKey().notNull(),
	workspaceId: text("workspace_id").notNull(),
	productId: text("product_id").notNull(),
	currentSubscriptionId: text("current_subscription_id"),
	appInstanceId: text("app_instance_id"),
	status: text().default('pending').notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	createdAt: bigint("created_at", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => [
	uniqueIndex("workspace_product_entitlements_app_instance_unique").using("btree", table.appInstanceId.asc().nullsLast().op("text_ops")),
	index("workspace_product_entitlements_current_subscription_idx").using("btree", table.currentSubscriptionId.asc().nullsLast().op("text_ops")),
	index("workspace_product_entitlements_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	uniqueIndex("workspace_product_entitlements_workspace_product_unique").using("btree", table.workspaceId.asc().nullsLast().op("text_ops"), table.productId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "workspace_product_entitlements_workspace_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [products.id],
			name: "workspace_product_entitlements_product_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.currentSubscriptionId],
			foreignColumns: [subscriptions.id],
			name: "workspace_product_entitlements_current_subscription_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.appInstanceId],
			foreignColumns: [appInstances.id],
			name: "workspace_product_entitlements_app_instance_id_fkey"
		}).onDelete("set null"),
]);

