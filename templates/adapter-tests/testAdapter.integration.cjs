'use strict';

const path = require('node:path');
const { tests } = require('@iobroker/testing');

// Copy this file to test/integration.test.js and adapt adapterRoot if needed.
// This starts the adapter against a real JS-Controller; it is not a mock startup test.
const adapterRoot = path.resolve(__dirname, '..');

tests.integration(adapterRoot, {
    // Set IOBROKER_TEST_CONTROLLER_VERSION to the adapter's minimum supported
    // js-controller version in a dedicated compatibility run. Unset means latest.
    ...(process.env.IOBROKER_TEST_CONTROLLER_VERSION
        ? { controllerVersion: process.env.IOBROKER_TEST_CONTROLLER_VERSION }
        : {}),

    // Add allowedExitCodes only if the adapter is documented and proven to exit
    // with those exact codes during the integration-test startup phase.
    // allowedExitCodes: [<documented-code>],

    defineAdditionalTests({ suite }) {
        suite('Adapter lifecycle', (getHarness) => {
            let harness;

            before(() => {
                harness = getHarness();
            });

            it('starts successfully', async () => {
                // This rejects/fails if the adapter cannot start and reach the harness readiness point.
                await harness.startAdapterAndWait();
            });

            // Add suites for your adapter's actual states, commands, messages and reconnect behavior.
            // Keep every describe/it under suite(...), as required by @iobroker/testing.
        });
    },
});
