
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
  }
}

/**
 * export stripe daemon
 *
 * @type {*}
 */
exports = module.exports = StripeDaemon;
