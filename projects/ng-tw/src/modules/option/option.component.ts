import { ENTER, hasModifierKey, SPACE } from '@angular/cdk/keycodes';
import { Component, ElementRef, EventEmitter, Input, OnInit, Output, ViewChild } from '@angular/core';
import * as _ from 'lodash';
import { difference } from 'lodash';
import { TwSelectConfig } from '../select/select-config.interface';
import { TwSelectConfigService } from '../select/select-config.service';

/**
 * Option IDs need to be unique across components, so this counter exists outside of
 * the component definition.
 */
let _uniqueIdCounter = 0;

/** Event object emitted by MatOption when selected or deselected. */
export class OptionSelectionChange<T = any> {
    constructor(
        /** Reference to the option that emitted the event. */
        public source: OptionComponent<T>,
        /** Whether the change in the option's value was a result of a user action. */
        public isUserInput: boolean = false,
        /** Content element */
        public innerHTML: string | null = null
    ) {}
}

@Component({
    selector: 'tw-option',
    templateUrl: './option.component.html',
    styleUrls: ['./option.component.css'],
    host: {
        '[attr.id]': 'id',
        '[attr.role]': 'option',
        '[class]': 'getClasses()',
        '(click)': 'select(true)',
    },
})
export class OptionComponent<T = any> implements OnInit {
    public selected: boolean = false;
    public active: boolean = false;

    private _config: TwSelectConfig['option'] = this.selectConfig.config.option;

    @Input() public class: string = '';
    @Input() public ignore: string = '';
    @Input() public activeClass: string = this._config.activeClass;
    @Input() public selectedClass: string = this._config.selectedClass;
    @Input() public indicatorClass: string = this._config.indicatorClass;
    @Input() public value: any;
    @Input() public disabled: boolean = false;
    @Input() public id: string = `tw-option-${_uniqueIdCounter++}`;
    @Input() public textOnly: boolean | string = true;

    @Input() public useSelectedIndicator: boolean = true;
    @Input() public indicator: 'left' | 'right' | null = 'right';

    @Output() readonly onSelectionChange = new EventEmitter<OptionSelectionChange<T>>();

    @ViewChild('content') public contentElement!: ElementRef;

    constructor(private readonly element: ElementRef<HTMLElement>, private readonly selectConfig: TwSelectConfigService) {}

    ngOnInit(): void {}

    /** Emits the selection change event. */
    private _emitSelectionChangeEvent(isUserInput = false): void {
        this.onSelectionChange.emit(new OptionSelectionChange<T>(this, isUserInput, this.getInnerHTML()));
    }

    /** Selects the option. */
    select(isUserInput: boolean = false): void {
        //
        // Validate disabled and alredy selected
        if (this.disabled) return;

        //
        // Select and emit event
        this._emitSelectionChangeEvent(isUserInput);
    }

    /**
     * `Selects the option while indicating the selection came from the user. Used to
     * determine if the select's view -> model callback should be invoked.`
     */
    selectViaInteraction(): void {
        if (!this.disabled) {
            this._emitSelectionChangeEvent(true);
        }
    }

    deselect(): void {
        this.selected = false;
    }

    toggle(isUserInput: boolean = false): void {
        this.selected = !this.selected;
    }

    /**
     * This method sets display styles on the option to make it appear
     * active. This is used by the ActiveDescendantKeyManager so key
     * events will display the proper options as active on arrow key events.
     */
    setActiveStyles(): void {
        if (!this.active) {
            this.active = true;
            this.scrollIntoView();
        }
    }

    /**
     * This method removes display styles on the option that made it appear
     * active. This is used by the ActiveDescendantKeyManager so key
     * events will display the proper options as active on arrow key events.
     */
    setInactiveStyles(): void {
        if (this.active) {
            this.active = false;
        }
    }

    /** Gets the label to be used when determining whether the option should be focused. */
    getLabel(): string {
        //
        // Hold element
        let element: HTMLElement = this.element.nativeElement;

        //
        // When textOnly is a string it means we have a selector to use
        if (typeof this.textOnly === 'string') {
            const elementForTextonly: HTMLElement | null = element.querySelector(this.textOnly);
            if (elementForTextonly) element = elementForTextonly;
        }

        return element.textContent ? element.textContent : '';
    }

    getInnerHTML(forceHTML: boolean = false): string | null {
        return this.textOnly !== false && forceHTML === false ? this.getLabel() : this.contentElement?.nativeElement?.innerHTML || null;
    }

    scrollIntoView() {
        // @TODO: center scrolling is not supported widely, check for alternative solution or polyfill
        if (typeof this.element.nativeElement.scrollIntoView !== 'undefined')
            this.element.nativeElement.scrollIntoView({
                block: 'center',
            });
    }

    setActiveStylesWithDelay(): void {
        setTimeout(() => {
            if (!this.active) {
                this.active = true;
            }

            this.scrollIntoView();
        });
    }

    getClasses() {
        //
        // Hold classes
        let classes: string[] = [];

        //
        // Set global config and classes
        const config: any = this._config;
        const globalClasses: string[] = config.class ? config.class.split(' ').filter((item: string) => item) : [];

        //
        // Get @input classes if available
        const inputClasses: string[] = this.class?.split(' ').filter((item: string) => item) || [];
        const inputIgnoreClasses: string[] = this?.ignore ? this.ignore.split(' ').filter((item: string) => item) : [];

        //
        // Add global classes
        classes = [...globalClasses];

        //
        // Filter global classes using global and @input ignore
        classes = difference(classes, inputClasses, inputIgnoreClasses);

        //
        // Get active and selected classes
        const activeClasses: string[] = this.activeClass ? this.activeClass.split(' ').filter((item: string) => item) : [];
        const selectedClasses: string[] = this.selectedClass ? this.selectedClass.split(' ').filter((item: string) => item) : [];

        //
        // Apply selected/active
        if (this.active === true) {
            classes = [...classes, ...activeClasses];
        }

        if (this.selected === true) {
            classes = [...classes, ...selectedClasses];
        }

        //
        // Indicator classes
        if (this.indicator === 'left') {
            classes = [...classes, ...['pl-9', 'pr-3']];
        } else if (this.indicator === 'right') {
            classes = [...classes, ...['pl-3', 'pr-9']];
        }

        return classes?.length ? classes.join(' ') : '';
    }

    getIndicatorClasses() {
        //
        // Validate indicator
        if (!this.indicator) return '';

        //
        // Hold classes
        let classes: string[] = [];

        //
        // Set global config and classes
        const config: any = this._config;
        const globalClasses: string[] = config.indicatorClass ? config.indicatorClass.split(' ').filter((item: string) => item) : [];
        const globalMandatoryClasses: string[] = config.indicatorMandatoryClass
            ? config.indicatorMandatoryClass.split(' ').filter((item: string) => item)
            : [];
        const inputClasses: string[] = this.indicatorClass ? this.indicatorClass.split(' ').filter((item: string) => item) : [];

        //
        // Add global classes
        classes = [...globalClasses, ...globalMandatoryClasses, ...inputClasses];

        //
        // Left/right
        if (this.indicator === 'left') {
            classes = [...classes, ...['left-0']];
        } else if (this.indicator === 'right') {
            classes = [...classes, ...['right-0']];
        }

        //
        // Selected
        if (this.selected === true) {
            classes = [...classes, ...['flex']];
        }

        return classes?.length ? classes.join(' ') : '';
    }
}
