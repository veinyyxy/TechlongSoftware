import { relations } from "drizzle-orm/relations";
import { products, appInstanceTemplates, appInstanceTemplateVersions, plans, users, userCredentials, authSessions, authInvitations, workspaces, subscriptions, paymentRecords, paymentCheckoutSessions, appInstances, subscriptionPurchaseOrders, paymentWebhookEvents, workspaceMembers, workspaceProductEntitlements } from "./postgres-schema";

export const appInstanceTemplatesRelations = relations(appInstanceTemplates, ({one, many}) => ({
	product: one(products, {
		fields: [appInstanceTemplates.productId],
		references: [products.id]
	}),
	appInstanceTemplateVersions: many(appInstanceTemplateVersions),
}));

export const productsRelations = relations(products, ({many}) => ({
	appInstanceTemplates: many(appInstanceTemplates),
	plans: many(plans),
	subscriptions: many(subscriptions),
	appInstances: many(appInstances),
	subscriptionPurchaseOrders: many(subscriptionPurchaseOrders),
	workspaceProductEntitlements: many(workspaceProductEntitlements),
}));

export const appInstanceTemplateVersionsRelations = relations(appInstanceTemplateVersions, ({one, many}) => ({
	appInstanceTemplate: one(appInstanceTemplates, {
		fields: [appInstanceTemplateVersions.templateId],
		references: [appInstanceTemplates.id]
	}),
	plans: many(plans),
	subscriptions: many(subscriptions),
	appInstances: many(appInstances),
	subscriptionPurchaseOrders: many(subscriptionPurchaseOrders),
}));

export const plansRelations = relations(plans, ({one, many}) => ({
	product: one(products, {
		fields: [plans.productId],
		references: [products.id]
	}),
	appInstanceTemplateVersion: one(appInstanceTemplateVersions, {
		fields: [plans.templateVersionId],
		references: [appInstanceTemplateVersions.id]
	}),
	workspaces: many(workspaces),
	subscriptions: many(subscriptions),
	paymentCheckoutSessions: many(paymentCheckoutSessions),
	subscriptionPurchaseOrders: many(subscriptionPurchaseOrders),
}));

export const workspacesRelations = relations(workspaces, ({one, many}) => ({
	user: one(users, {
		fields: [workspaces.ownerId],
		references: [users.id]
	}),
	plan: one(plans, {
		fields: [workspaces.planId],
		references: [plans.id]
	}),
	subscriptions: many(subscriptions),
	paymentRecords: many(paymentRecords),
	paymentCheckoutSessions: many(paymentCheckoutSessions),
	appInstances: many(appInstances),
	subscriptionPurchaseOrders: many(subscriptionPurchaseOrders),
	workspaceMembers: many(workspaceMembers),
	workspaceProductEntitlements: many(workspaceProductEntitlements),
}));

export const usersRelations = relations(users, ({one, many}) => ({
	workspaces: many(workspaces),
	userCredential: one(userCredentials),
	authSessions: many(authSessions),
	authInvitations: many(authInvitations, {
		relationName: "authInvitations_userId_users_id"
	}),
	createdAuthInvitations: many(authInvitations, {
		relationName: "authInvitations_createdByUserId_users_id"
	}),
	subscriptions: many(subscriptions),
	paymentRecords: many(paymentRecords),
	paymentCheckoutSessions: many(paymentCheckoutSessions),
	appInstances: many(appInstances),
	subscriptionPurchaseOrders: many(subscriptionPurchaseOrders),
	workspaceMembers: many(workspaceMembers),
}));

export const userCredentialsRelations = relations(userCredentials, ({one}) => ({
	user: one(users, {
		fields: [userCredentials.userId],
		references: [users.id]
	}),
}));

export const authSessionsRelations = relations(authSessions, ({one}) => ({
	user: one(users, {
		fields: [authSessions.userId],
		references: [users.id]
	}),
}));

export const authInvitationsRelations = relations(authInvitations, ({one}) => ({
	user: one(users, {
		fields: [authInvitations.userId],
		references: [users.id],
		relationName: "authInvitations_userId_users_id"
	}),
	createdByUser: one(users, {
		fields: [authInvitations.createdByUserId],
		references: [users.id],
		relationName: "authInvitations_createdByUserId_users_id"
	}),
}));

export const subscriptionsRelations = relations(subscriptions, ({one, many}) => ({
	workspace: one(workspaces, {
		fields: [subscriptions.workspaceId],
		references: [workspaces.id]
	}),
	product: one(products, {
		fields: [subscriptions.productId],
		references: [products.id]
	}),
	plan: one(plans, {
		fields: [subscriptions.planId],
		references: [plans.id]
	}),
	appInstanceTemplateVersion: one(appInstanceTemplateVersions, {
		fields: [subscriptions.templateVersionId],
		references: [appInstanceTemplateVersions.id]
	}),
	user: one(users, {
		fields: [subscriptions.createdByUserId],
		references: [users.id]
	}),
	paymentRecords: many(paymentRecords),
	paymentCheckoutSessions: many(paymentCheckoutSessions),
	appInstances: many(appInstances),
	subscriptionPurchaseOrders_subscriptionId: many(subscriptionPurchaseOrders, {
		relationName: "subscriptionPurchaseOrders_subscriptionId_subscriptions_id"
	}),
	subscriptionPurchaseOrders_renewalSubscriptionId: many(subscriptionPurchaseOrders, {
		relationName: "subscriptionPurchaseOrders_renewalSubscriptionId_subscriptions_id"
	}),
	workspaceProductEntitlements: many(workspaceProductEntitlements),
}));

export const paymentRecordsRelations = relations(paymentRecords, ({one, many}) => ({
	workspace: one(workspaces, {
		fields: [paymentRecords.workspaceId],
		references: [workspaces.id]
	}),
	subscription: one(subscriptions, {
		fields: [paymentRecords.subscriptionId],
		references: [subscriptions.id]
	}),
	user: one(users, {
		fields: [paymentRecords.recordedByUserId],
		references: [users.id]
	}),
	paymentCheckoutSessions: many(paymentCheckoutSessions),
	subscriptionPurchaseOrders: many(subscriptionPurchaseOrders),
}));

export const paymentCheckoutSessionsRelations = relations(paymentCheckoutSessions, ({one, many}) => ({
	workspace: one(workspaces, {
		fields: [paymentCheckoutSessions.workspaceId],
		references: [workspaces.id]
	}),
	subscription: one(subscriptions, {
		fields: [paymentCheckoutSessions.subscriptionId],
		references: [subscriptions.id]
	}),
	plan: one(plans, {
		fields: [paymentCheckoutSessions.planId],
		references: [plans.id]
	}),
	paymentRecord: one(paymentRecords, {
		fields: [paymentCheckoutSessions.paymentRecordId],
		references: [paymentRecords.id]
	}),
	user: one(users, {
		fields: [paymentCheckoutSessions.initiatedByUserId],
		references: [users.id]
	}),
	paymentWebhookEvents: many(paymentWebhookEvents),
}));

export const appInstancesRelations = relations(appInstances, ({one, many}) => ({
	workspace: one(workspaces, {
		fields: [appInstances.workspaceId],
		references: [workspaces.id]
	}),
	product: one(products, {
		fields: [appInstances.productId],
		references: [products.id]
	}),
	subscription: one(subscriptions, {
		fields: [appInstances.subscriptionId],
		references: [subscriptions.id]
	}),
	appInstanceTemplateVersion: one(appInstanceTemplateVersions, {
		fields: [appInstances.templateVersionId],
		references: [appInstanceTemplateVersions.id]
	}),
	user: one(users, {
		fields: [appInstances.createdByUserId],
		references: [users.id]
	}),
	workspaceProductEntitlements: many(workspaceProductEntitlements),
}));

export const subscriptionPurchaseOrdersRelations = relations(subscriptionPurchaseOrders, ({one, many}) => ({
	workspace: one(workspaces, {
		fields: [subscriptionPurchaseOrders.workspaceId],
		references: [workspaces.id]
	}),
	product: one(products, {
		fields: [subscriptionPurchaseOrders.productId],
		references: [products.id]
	}),
	plan: one(plans, {
		fields: [subscriptionPurchaseOrders.planId],
		references: [plans.id]
	}),
	appInstanceTemplateVersion: one(appInstanceTemplateVersions, {
		fields: [subscriptionPurchaseOrders.templateVersionId],
		references: [appInstanceTemplateVersions.id]
	}),
	subscription_subscriptionId: one(subscriptions, {
		fields: [subscriptionPurchaseOrders.subscriptionId],
		references: [subscriptions.id],
		relationName: "subscriptionPurchaseOrders_subscriptionId_subscriptions_id"
	}),
	subscription_renewalSubscriptionId: one(subscriptions, {
		fields: [subscriptionPurchaseOrders.renewalSubscriptionId],
		references: [subscriptions.id],
		relationName: "subscriptionPurchaseOrders_renewalSubscriptionId_subscriptions_id"
	}),
	paymentRecord: one(paymentRecords, {
		fields: [subscriptionPurchaseOrders.paymentRecordId],
		references: [paymentRecords.id]
	}),
	user: one(users, {
		fields: [subscriptionPurchaseOrders.createdByUserId],
		references: [users.id]
	}),
	paymentWebhookEvents: many(paymentWebhookEvents),
}));

export const paymentWebhookEventsRelations = relations(paymentWebhookEvents, ({one}) => ({
	paymentCheckoutSession: one(paymentCheckoutSessions, {
		fields: [paymentWebhookEvents.checkoutSessionId],
		references: [paymentCheckoutSessions.id]
	}),
	subscriptionPurchaseOrder: one(subscriptionPurchaseOrders, {
		fields: [paymentWebhookEvents.purchaseOrderId],
		references: [subscriptionPurchaseOrders.id]
	}),
}));

export const workspaceMembersRelations = relations(workspaceMembers, ({one}) => ({
	workspace: one(workspaces, {
		fields: [workspaceMembers.workspaceId],
		references: [workspaces.id]
	}),
	user: one(users, {
		fields: [workspaceMembers.userId],
		references: [users.id]
	}),
}));

export const workspaceProductEntitlementsRelations = relations(workspaceProductEntitlements, ({one}) => ({
	workspace: one(workspaces, {
		fields: [workspaceProductEntitlements.workspaceId],
		references: [workspaces.id]
	}),
	product: one(products, {
		fields: [workspaceProductEntitlements.productId],
		references: [products.id]
	}),
	subscription: one(subscriptions, {
		fields: [workspaceProductEntitlements.currentSubscriptionId],
		references: [subscriptions.id]
	}),
	appInstance: one(appInstances, {
		fields: [workspaceProductEntitlements.appInstanceId],
		references: [appInstances.id]
	}),
}));
