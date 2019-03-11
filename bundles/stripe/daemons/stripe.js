
// require daemon
const config = require('config');
const Daemon = require('daemon');
const stripe = require('stripe');

/**
 * Stripe Daemon
 *
 * @extends Daemon
 */
class StripeDaemon extends Daemon {
  /**
   * construct stripe daemon
   */
  constructor() {
    // run super
    super(...arguments);

    // Set private variables
    this._stripe = stripe(config.get('stripe.secret'));

    // add endpoint
    this.eden.endpoint('subscription.stripe.cancel', async (subscription) => {
      // cancel subscription
      subscription.set('cancel', await this._stripe.subscriptions.update(subscription.get('charge.id'), {
        cancel_at_period_end : true,
      }));

      // set state
      subscription.set('state', 'cancelled');

      // save subscription
      await subscription.save();
    });

    // update agreement
    this.eden.endpoint('subscription.stripe.update', async (subscription) => {
      // cancel subscription
      const agreement = await this._stripe.subscriptions.retrieve(subscription.get('charge.id'));

      // check active
      if (agreement.status !== 'active' || agreement.cancel_at_period_end) {
        // set cancel
        subscription.set('cancel', agreement);

        // set state
        subscription.set('state', 'cancelled');

        // save subscription
        await subscription.save();
      }
    });
  }
}

/**
 * export stripe daemon
 *
 * @type {*}
 */
exports = module.exports = StripeDaemon;
