/** mocha-cakes-2 BDD UI and chai expect globals, see .mocharc.json */

declare const expect: (typeof import('chai'))['expect'];

declare const Feature: Mocha.SuiteFunction;
declare const Scenario: Mocha.SuiteFunction;
declare const Given: Mocha.TestFunction;
declare const When: Mocha.TestFunction;
declare const Then: Mocha.TestFunction;
declare const And: Mocha.TestFunction;
declare const But: Mocha.TestFunction;
declare function beforeEachScenario(fn: Mocha.Func | Mocha.AsyncFunc): void;
declare function afterEachScenario(fn: Mocha.Func | Mocha.AsyncFunc): void;
