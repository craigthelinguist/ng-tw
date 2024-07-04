import {
    AfterContentInit,
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    ContentChildren,
    ElementRef,
    forwardRef,
    Input,
    NgZone,
    OnInit,
    QueryList,
    ViewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { defer, merge, Observable, startWith, switchMap, take } from 'rxjs';
import { OptionComponent, OptionSelectionChange } from '../option/option.component';
import { A, DOWN_ARROW, ENTER, hasModifierKey, SPACE, UP_ARROW } from '@angular/cdk/keycodes';
import { ActiveDescendantKeyManager, LiveAnnouncer } from '@angular/cdk/a11y';
import { difference } from 'lodash';
import { TwSelectConfig } from './select-config.interface';
import { TwSelectConfigService } from './select-config.service';
import { ConnectedPosition, Overlay } from '@angular/cdk/overlay';

/**
 * IDs need to be unique across components, so this counter exists outside of
 * the component definition.
 */
let _uniqueIdCounter = 0;

@Component({
    selector: 'tw-select',
    templateUrl: './select.component.html',
    styleUrls: ['./select.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        '[attr.tabindex]': '0',
        '[attr.role]': 'combobox',
        '[attr.aria-autocomplete]': 'none',
        // TODO: the value for aria-haspopup should be `listbox`, but currently it's difficult
        // to sync into Google, because of an outdated automated a11y check which flags it as an invalid
        // value. At some point we should try to switch it back to being `listbox`.
        // '[attr.aria-haspopup]': 'true',
        '[class]': 'getClasses()',
        '[attr.id]': 'id',
        '[attr.aria-controls]': 'isOpen ? id + "-panel" : null',
        '[attr.aria-expanded]': 'isOpen',
        '[attr.aria-disabled]': 'disabled.toString()',
        '[attr.aria-haspopup]': 'listbox',
        '[attr.aria-labelledby]': 'listbox-label',
        '(keydown)': 'handleKeydown($event)',
        '(click)': 'openPanel()',
        cdkOverlayOrigin: '',
    },
    providers: [
        {
            provide: NG_VALUE_ACCESSOR,
            useExisting: forwardRef(() => SelectComponent),
            multi: true,
        },
    ],
})
export class SelectComponent implements ControlValueAccessor, OnInit, AfterContentInit {
    @Input() public class: string = '';
    @Input() public ignore: string = '';
    @Input() public panelClass: string = '';
    @Input() public panelIgnoreClass: string = '';
    @Input() public placeholder: string = 'Select an option';
    @Input() public disabled: boolean = false;
    @Input() public id: string = `tw-select-${_uniqueIdCounter++}`;
    @Input() public compareWith: (o1: any, o2: any) => boolean = (o1: any, o2: any) => o1 === o2;
    @Input()
    get value(): any {
        return this._multiple ? this.innerValues : this.innerValue;
    }
    set value(newValue: any) {
        if (this._multiple) {
            this.setMultipleOptions(newValue, null, false);
        } else {
            this.selectOption(newValue, null, false);
        }
    }

    @Input()
    set multiple(param: string) {
        this._multiple = true;
    }

    @ViewChild('arrowContainer', { static: true }) public arrowContainer!: ElementRef<HTMLDivElement>;
    @ViewChild('inputContainer', { static: true }) public inputContainer!: ElementRef<HTMLDivElement>;
    @ViewChild('trigger', { static: true }) public trigger!: ElementRef;
    @ContentChildren(OptionComponent, { descendants: true }) public options!: QueryList<OptionComponent>;

    public onChange = (value: any) => {};
    public onTouched = () => {};

    public innerValue: any = null;

    // This is used when it is a multiple select.
    public innerValues: any[] = [];

    public get htmlValue(): string | null {
        //
        // Validate inner value
        if (!this.innerValue && !this._keyManager.activeItem) return null;
        else return this._keyManager.activeItem?.getInnerHTML() || null;
    }

    private _htmlValue: string | null = null;

    public wasTouched: boolean = false;
    public isOpen: boolean = false;
    public overlayWidth!: string;
    public _multiple: boolean = false;

    private _keyManager!: ActiveDescendantKeyManager<OptionComponent>;
    private _config: TwSelectConfig['select'] = this.selectConfig.config.select;
    public _scrollStrategy: any = this.overlay.scrollStrategies.block();

    public positions: ConnectedPosition[] = [
        {
            originX: 'start',
            originY: 'bottom',
            overlayX: 'start',
            overlayY: 'top',
            offsetY: 8,
        },
        {
            originX: 'end',
            originY: 'bottom',
            overlayX: 'end',
            overlayY: 'top',
            offsetY: 8,
        },
        {
            originX: 'start',
            originY: 'top',
            overlayX: 'start',
            overlayY: 'bottom',
            offsetY: -8,
        },
        {
            originX: 'end',
            originY: 'top',
            overlayX: 'end',
            overlayY: 'bottom',
            offsetY: -8,
        },
    ];

    /** Combined stream of all of the child options' change events. */
    readonly optionSelectionChanges: Observable<OptionSelectionChange> = defer(() => {
        const options = this.options;

        if (options) {
            return options.changes.pipe(
                startWith(options),
                switchMap(() => merge(...options.map((option) => option.onSelectionChange)))
            );
        }

        return this.zone.onStable.pipe(
            take(1),
            switchMap(() => this.optionSelectionChanges)
        );
    }) as Observable<OptionSelectionChange>;

    constructor(
        public cdr: ChangeDetectorRef,
        public elementRef: ElementRef,
        public overlay: Overlay,
        private readonly zone: NgZone,
        private readonly liveAnnouncer: LiveAnnouncer,
        private readonly selectConfig: TwSelectConfigService
    ) {}

    ngOnInit(): void {}

    ngAfterContentInit(): void {
        this._initKeyManager();

        this.optionSelectionChanges.subscribe((event) => {
            this._multiple
                ? this.onMultiSelect(event.source, event.isUserInput, event.innerHTML)
                : this.onSelect(event.source, event.isUserInput, event.innerHTML);
            this.cdr.markForCheck();
        });

        this.options.changes.pipe(startWith(null)).subscribe(() => {
            // Defer setting the value in order to avoid the "Expression
            // has changed after it was checked" errors from Angular.
            Promise.resolve().then(() => {
                this._multiple
                    ? this.onNewMultipleOptionsSet(this.innerValues, null, false, true)
                    : this.selectOption(this.innerValue, null ,false, true);
            });
        });
    }

    writeValue(value: any) {
        this._multiple
            ? this.setMultipleOptions(value, null, false)
            : this.selectOption(value, null, false);

        this.cdr.markForCheck();
    }

    registerOnChange(onChange: any) {
        this.onChange = onChange;
    }

    registerOnTouched(onTouched: any) {
        this.onTouched = onTouched;
    }

    markAsTouched() {
        if (!this.wasTouched) {
            this.onTouched();
            this.wasTouched = true;
        }
    }

    setDisabledState(isDisabled: boolean) {
        //
        // Set disabled
        this.disabled = isDisabled;

        //
        // Set aria-disabled
        this.trigger?.nativeElement.setAttribute('aria-disabled', isDisabled.toString());
    }

    openPanel() {
        //
        // Validate disabled
        if (this.disabled === true) return;

        //
        // open panel
        this.isOpen = true;

        //
        // Scroll if we have an active item
        if (!this._multiple) {
            if (this._keyManager.activeItem) this._keyManager.activeItem.setActiveStylesWithDelay();
        }
    }

    closePanel() {
        //
        // Update manager active item
        if (this.hasValue()) {
            if (this._multiple) {
                this._keyManager.setActiveItem(-1);
            } else {
                this._updateKeyManagerActiveItem(this.innerValue);
            }
        }

        // close
        this.isOpen = false;
    }

    backdropClick() {
        this.closePanel();
    }

    hasValue(): boolean {
        if (this._multiple) {
            return this.innerValues.length > 0;
        } else {
            return !!(this.innerValue);
        }
    }

    onNewMultipleOptionsSet(oldValues: any, innerHTML: string | null, touched: boolean, forceUpdate = false) {
        // Update the options based on the old selected values
        const updatedValues: any[] = [];

        //
        // Skip if we don't have options
        if (!this.options) {
            return;
        }

        this.options.forEach(opt => {
            if (oldValues.find((oldValue: any) => this.compareWith(opt.value, oldValue))) {
                opt.select(false, false);
                updatedValues.push(opt.value);
            } else {
                opt.deselect();
            }
        });

        //
        // Emit the new selected values.
        this.innerValues = updatedValues;
        this.onChange(updatedValues);

        //
        // Update manager active item
        this._keyManager.setActiveItem(-1);
    }

    setMultipleOptions(newValues: any, innerHTML: string | null, touched: boolean, forceUpdate = false) {
        if (this.innerValues === newValues && forceUpdate === false) {
            return;
        }

        //
        // Skip if we don't have options
        if (!this.options) {
            return;
        }

        //
        // Set new values and emit
        newValues = newValues ?? [];  // treat null or undefined like empty list
        this.options.forEach(opt => {
            if (newValues.find((newValue: any) => this.compareWith(opt.value, newValue))) {
                opt.select(false, false);
            } else {
                opt.deselect();
            }
        })

        this.innerValues = newValues;
        this.onChange(this.innerValues);

        // Mark as touched if this was made by a user interaction
        if (touched === true) {
            this.markAsTouched();
        }

        //
        // Set focus to the first item
        this._keyManager.setActiveItem(-1);
    }

    selectOption(newValue: any, innerHTML: string | null, touched: boolean, forceUpdate = false) {
        //
        // Do nothing if selected is the same as the current value
        if (this.compareWith(this.innerValue, newValue) && forceUpdate === false) {
            return;
        }

        //
        // Set new value
        this.innerValue = newValue;

        //
        // On change event
        this.onChange(newValue);
        // mark as touched if this was made by a user interaction
        if (touched === true) this.markAsTouched();

        //
        // Skip if we don't have options
        if (!this.options) return;

        //
        // Update manager active item
        this._updateKeyManagerActiveItem(newValue);
    }

    onSelect(source: OptionComponent, isUserInput: boolean, innerHTML: string | null) {
        //
        // Validate value is different
        if (this.innerValue === source.value) return this.closePanel();

        //
        // Loop options and deselect all except the selected one
        this.options.forEach((option) => {
            if (option.selected === true && option.id !== source.id) {
                option.deselect(isUserInput);
            }
        });

        //
        // Select option
        this.selectOption(source.value, innerHTML, true);

        //
        // Close
        this.closePanel();
    }

    onMultiSelect(source: OptionComponent, isUserInput: boolean, innerHTML: string | null) {
        const index = this.innerValues.findIndex(innerValue => this.compareWith(innerValue, source.value));
        if (index === -1) {
            // item is not selected; add it to inner values
            this.innerValues.push(source.value);
        } else {
            // it is already selected; remove it from inner values
            this.innerValues.splice(index, 1);
        }

        source.toggle(isUserInput);

        //
        // Emit the new selected values.
        this.onChange(this.innerValues);

        //
        // Mark as touched if this was made by a user interaction.
        if (isUserInput === true) {
            this.markAsTouched();
        }

        //
        // Skip if we don't have options
        if (!this.options) {
            return;
        }

        //
        // Update manager active item
        this._updateKeyManagerActiveItem(source.value);
    }

    handleKeydown(event: KeyboardEvent) {
        if (!this.disabled) {
            this.isOpen === true ? this._handleOpenKeydown(event) : this._handleClosedKeydown(event);
        }
    }

    private _handleClosedKeydown(event: KeyboardEvent): void {
        const manager = this._keyManager;

        manager.onKeydown(event);
    }

    /** Handles keyboard events when the selected is open. */
    private _handleOpenKeydown(event: KeyboardEvent): void {
        const manager = this._keyManager;
        const keyCode = event.keyCode;
        const isArrowKey = keyCode === DOWN_ARROW || keyCode === UP_ARROW;
        const isTyping = manager.isTyping();

        if (isArrowKey && event.altKey) {
            // Close the select on ALT + arrow key to match the native <select>
            event.preventDefault();
            this.closePanel();
            // Don't do anything in this case if the user is typing,
            // because the typing sequence can include the space key.
        } else if (!isTyping && (keyCode === ENTER || keyCode === SPACE) && manager.activeItem && !hasModifierKey(event)) {
            event.preventDefault();
            manager.activeItem.selectViaInteraction();
        } else {
            manager.onKeydown(event);

            // // We set a duration on the live announcement, because we want the live element to be
            // // cleared after a while so that users can't navigate to it using the arrow keys.
            // this.liveAnnouncer.announce((manager.activeItem as OptionComponent)?.contentElement?.nativeElement?.innerHTML, 10000);
        }
    }

    private _initKeyManager() {
        this._keyManager = new ActiveDescendantKeyManager<OptionComponent>(this.options)
            .withTypeAhead()
            .withVerticalOrientation()
            .withHomeAndEnd()
            .withWrap()
            .withAllowedModifierKeys(['shiftKey']);

        this._keyManager.change.pipe().subscribe(() => {
            if (!this.isOpen && this._keyManager.activeItem) {
                this._keyManager.activeItem.selectViaInteraction();
            }
        });
    }

    private _updateKeyManagerActiveItem(value: any) {
        //
        // Set key manager
        const manager = this._keyManager;

        //
        // Update focus for different values
        if (!this.compareWith(manager.activeItem?.value, value)) {
            //
            // Find selected option index
            const correspondingOption = this.options.find((option: OptionComponent) => {
                return option.value != null && this.compareWith(option.value, value);
            });

            // validate and update active item
            if (correspondingOption) manager.setActiveItem(correspondingOption);
            else manager.setActiveItem(-1);
        }
    }



    getClasses() {
        //
        // Hold classes
        let classes: string[] = [];

        //
        // Set global config and classes
        const config: any = this._config;
        const globalClasses: string[] = config.host.class ? config.host.class.split(' ').filter((item: string) => item) : [];

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

        return classes?.length ? classes.join(' ') : '';
    }

    getPanelClass() {
        //
        // Hold classes
        let classes: string[] = [];

        //
        // Set global config and classes
        const config: any = this._config;
        const globalClasses: string[] = config.panel.class ? config.panel.class.split(' ').filter((item: string) => item) : [];
        const globalMandatoryClasses: string[] = config.panel.mandatoryClass
            ? config.panel.mandatoryClass.split(' ').filter((item: string) => item)
            : [];

        //
        // Get @input classes if available
        const inputClasses: string[] = this.panelClass?.split(' ').filter((item: string) => item) || [];
        const inputIgnoreClasses: string[] = this?.panelIgnoreClass ? this.panelIgnoreClass.split(' ').filter((item: string) => item) : [];

        //
        // Add global classes
        classes = [...globalClasses];

        //
        // Filter global classes using global and @input ignore
        classes = difference(classes, inputClasses, inputIgnoreClasses);

        //
        // Add mandatory classes
        classes = [...classes, ...globalMandatoryClasses];

        return classes?.length ? classes.join(' ') : '';
    }
}
