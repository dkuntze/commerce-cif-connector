/*******************************************************************************
 *
 *    Copyright 2019 Adobe. All rights reserved.
 *    This file is licensed to you under the Apache License, Version 2.0 (the "License");
 *    you may not use this file except in compliance with the License. You may obtain a copy
 *    of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 *    Unless required by applicable law or agreed to in writing, software distributed under
 *    the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 *    OF ANY KIND, either express or implied. See the License for the specific language
 *    governing permissions and limitations under the License.
 *
 ******************************************************************************/

'use strict';

const ci = new (require('./ci.js'))();

ci.context();

ci.stage('Project Configuration');
const config = ci.restoreConfiguration();
console.log(config);
const qpPath = '/home/circleci/cq';

try {
    ci.stage("Integration Tests");
    ci.dir(qpPath, () => {
        // Connect to QP
        ci.sh('./qp.sh -v bind --server-hostname localhost --server-port 55555');

        // Start CQ
        ci.sh(`./qp.sh -v start --id author --runmode author --port 4502 --qs-jar /home/circleci/cq/author/cq-quickstart.jar \
            --bundle org.apache.sling:org.apache.sling.junit.core:1.0.23:jar \
            --bundle com.adobe.commerce.cif:graphql-client:1.3.0:jar \
            --bundle com.adobe.commerce.cif:magento-graphql:5.1.0-magento234:jar \
            --bundle com.adobe.cq:core.wcm.components.all:2.4.0:zip \
            ${ci.addQpFileDependency(config.modules['cif-connector-graphql'])} \
            ${ci.addQpFileDependency(config.modules['cif-virtual-catalog'])} \
            ${ci.addQpFileDependency(config.modules['cif-connector-content'])} \
            ${ci.addQpFileDependency(config.modules['cif-virtual-catalog-content'])} \
            ${ci.addQpFileDependency(config.modules['it-test-content'])} \
            --vm-options \\\"-Xmx1536m -XX:MaxPermSize=256m -Djava.awt.headless=true -javaagent:${process.env.JACOCO_AGENT}=destfile=crx-quickstart/jacoco-it.exec\\\"`);
    });

    // Run integration tests
    ci.sh(`mvn clean verify -U -B \
        -Ptest-all \
        -Dsling.it.instance.url.1=http://localhost:4502 \
        -Dsling.it.instance.runmode.1=author \
        -Dsling.it.instances=1`);

    ci.dir(qpPath, () => {
        // Stop CQ
        ci.sh('./qp.sh -v stop --id author');
    });

    // Create coverage reports
    const createCoverageReport = () => {
        // Executing the integration tests runs also executes unit tests and generates a Jacoco report for them. To 
        // strictly separate unit test from integration test coverage, we explicitly delete the unit test report first.
        ci.sh('rm -rf target/site/jacoco');

        // Download Jacoco file which is exposed by a webserver running inside the AEM container.
        ci.sh('curl -O -f http://localhost:3000/crx-quickstart/jacoco-it.exec');

        // Generate new report
        ci.sh(`mvn -B org.jacoco:jacoco-maven-plugin:${process.env.JACOCO_VERSION}:report -Djacoco.dataFile=jacoco-it.exec`);

        // Upload report to codecov
        ci.sh('curl -s https://codecov.io/bash | bash -s -- -c -F integration -f target/site/jacoco/jacoco.xml');
    };

    ci.dir('bundles/cif-connector-graphql', createCoverageReport);
    ci.dir('bundles/cif-virtual-catalog', createCoverageReport);

} finally { // Always download logs from AEM container
    ci.sh('mkdir logs');
    ci.dir('logs', () => {
        // A webserver running inside the AEM container exposes the logs folder, so we can download log files as needed.
        ci.sh('curl -O -f http://localhost:3000/crx-quickstart/logs/error.log');
        ci.sh('curl -O -f http://localhost:3000/crx-quickstart/logs/stdout.log');
        ci.sh('curl -O -f http://localhost:3000/crx-quickstart/logs/stderr.log');
        ci.sh('curl -O -f http://localhost:3000/crx-quickstart/logs/commerce.log');
        ci.sh(`find . -name '*.log' -type f -size +32M -exec echo 'Truncating: ' {} \\; -execdir truncate --size 32M {} +`);
    });
}