import { Router } from 'express';
import { db } from '../config/firebase.js';

export const publicRouter: Router = Router();

const defaultPublicContent = {
  privacyPolicy: 'CareMax processes triage and operational data to provide secure healthcare support services. Legal policy content is maintained by the SaaS administrator.',
  termsOfService: 'Use of CareMax must comply with applicable law and clinical governance standards. Full service terms are maintained by the SaaS administrator.',
  contactEmail: 'support@caremax.health',
  contactPhonePrimary: '+256782830524',
  contactPhoneSecondary: '+256753190830',
  enableLandingVanta: false,
  landingVantaEmbedCode: '',
};

publicRouter.get('/content', async (_req, res) => {
  try {
    const doc = await db.collection('platform_settings').doc('public_content').get();
    const data = doc.data() ?? {};

    res.json({
      privacyPolicy: typeof data.privacyPolicy === 'string' && data.privacyPolicy.trim() ? data.privacyPolicy : defaultPublicContent.privacyPolicy,
      termsOfService: typeof data.termsOfService === 'string' && data.termsOfService.trim() ? data.termsOfService : defaultPublicContent.termsOfService,
      contactEmail: typeof data.contactEmail === 'string' && data.contactEmail.trim() ? data.contactEmail : defaultPublicContent.contactEmail,
      contactPhonePrimary: typeof data.contactPhonePrimary === 'string' && data.contactPhonePrimary.trim() ? data.contactPhonePrimary : defaultPublicContent.contactPhonePrimary,
      contactPhoneSecondary: typeof data.contactPhoneSecondary === 'string' && data.contactPhoneSecondary.trim() ? data.contactPhoneSecondary : defaultPublicContent.contactPhoneSecondary,
      enableLandingVanta: data.enableLandingVanta === true,
      landingVantaEmbedCode: typeof data.landingVantaEmbedCode === 'string' ? data.landingVantaEmbedCode : defaultPublicContent.landingVantaEmbedCode,
    });
  } catch (error) {
    console.error('Failed to load public content:', error);
    res.status(500).json({ error: 'Failed to load public content' });
  }
});

publicRouter.get('/billing/plans', async (_req, res) => {
  try {
    let snap = await db.collection('billing_plans').orderBy('priceUsd', 'asc').get();

    if (snap.empty) {
      const defaults = [
        { id: 'free', name: 'Free Trial', priceUgx: 0, priceUsd: 0, billingCycle: 'monthly', trialDays: 30, active: true, description: 'Trial only (not available for re-subscribe)' },
        { id: 'starter', name: 'Starter Pack', priceUgx: 38000, priceUsd: 10, billingCycle: 'monthly', trialDays: 0, active: true, description: 'Starter plan' },
        { id: 'advanced', name: 'Advanced Pack', priceUgx: 76000, priceUsd: 20, billingCycle: 'monthly', trialDays: 0, active: true, description: 'Advanced plan' },
        { id: 'super', name: 'Super Pack', priceUgx: 228000, priceUsd: 60, billingCycle: 'monthly', trialDays: 0, active: true, description: 'Super plan' },
        { id: 'enterprise', name: 'Enterprise', priceUgx: 380000, priceUsd: 100, billingCycle: 'monthly', trialDays: 0, active: true, description: 'Enterprise plan' },
      ];
      const batch = db.batch();
      for (const plan of defaults) {
        batch.set(db.collection('billing_plans').doc(plan.id), { ...plan, updatedAt: new Date() });
      }
      await batch.commit();
      snap = await db.collection('billing_plans').orderBy('priceUsd', 'asc').get();
    }

    const plans = snap.docs
      .map((doc) => {
        const data = doc.data();
        const priceUgx = typeof data.priceUgx === 'number'
          ? data.priceUgx
          : (typeof data.priceUsd === 'number' ? Math.round(data.priceUsd * Number(process.env.MARZPAY_USD_TO_UGX_RATE ?? 3800)) : 0);
        return {
          id: doc.id,
          name: typeof data.name === 'string' ? data.name : doc.id,
          description: typeof data.description === 'string' ? data.description : '',
          priceUgx,
          trialDays: typeof data.trialDays === 'number' ? data.trialDays : 0,
          active: data.active !== false,
        };
      })
      .filter((plan) => plan.active)
      .sort((a, b) => a.priceUgx - b.priceUgx);

    res.json({ plans });
  } catch (error) {
    console.error('Failed to load public billing plans:', error);
    res.status(500).json({ error: 'Failed to load billing plans' });
  }
});
