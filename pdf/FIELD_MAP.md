# Field map (2025)

Built by `scripts/build_field_map.py`. The last column is the text printed beside each field on the IRS form, copied from the PDF so each row can be checked.


## sources/f1041_2025.pdf

| Return line | PDF field | Type | Printed beside the field |
|---|---|---|---|
| Name of estate or trust | `f1_4` (page 1) | text | Simple trust |
| Name and title of fiduciary | `f1_5` (page 1) | text | Qualified disability trust |
| Number and street | `f1_6` (page 1) | text | Grantor type trust |
| City or town | `f1_8` (page 1) | text | Pooled income fund |
| State | `f1_9` (page 1) | text | Pooled income fund |
| ZIP code | `f1_11` (page 1) | text | Pooled income fund |
| A: Simple trust | `c1_2` (page 1) | checkbox | Simple trust |
| A: Complex trust | `c1_3` (page 1) | checkbox | Complex trust Name |
| B: Number of Schedules K-1 attached | `f1_12` (page 1) | text | instructions) |
| C: Employer identification number | `f1_13` (page 1) | text | Simple trust |
| D: Date entity created | `f1_14` (page 1) | text | Qualified disability trust |
| F: Initial return | `c1_13` (page 1) | checkbox | B Number of Schedules K-1 F Check |
| F: Final return | `c1_14` (page 1) | checkbox | Number of Schedules K-1 F Check Initial return |
| F: Amended return | `c1_15` (page 1) | checkbox | Schedules K-1 F Check Initial return Final return |
| F: Change in trust's name | `c1_17` (page 1) | checkbox | instructions) boxes: |
| F: Change in fiduciary | `c1_18` (page 1) | checkbox | instructions) boxes: Change in trust’s name |
| F: Change in fiduciary's name | `c1_19` (page 1) | checkbox | boxes: Change in trust’s name Change in fiduciary |
| F: Change in fiduciary's address | `c1_20` (page 1) | checkbox | name Change in fiduciary Change in fiduciary’s name |
| Line 1: Interest income | `f1_16` (page 1) | text | 1 Interest income 1 |
| Line 2a: Total ordinary dividends | `f1_17` (page 1) | text | 2a Total ordinary dividends 2a |
| Line 2b(1): Qualified dividends, beneficiaries | `f1_18` (page 1) | text | b Qualified dividends allocable to: (1) Beneficiaries |
| Line 2b(2): Qualified dividends, estate or trust | `f1_19` (page 1) | text | allocable to: (1) Beneficiaries (2) Estate or trust |
| Line 4: Capital gain or (loss) | `f1_21` (page 1) | text | or (loss). Attach Schedule D (Form 1041) 4 |
| Line 9: Total income | `f1_27` (page 1) | text | lines 1, 2a, and 3 through 8 9 |
| Line 12: Fiduciary fees | `f1_30` (page 1) | text | is deductible under section 67(e), see instructions 12 |
| Line 14: Attorney, accountant, and return preparer fees | `f1_32` (page 1) | text | see instructions 14 |
| Line 16: Add lines 10 through 15b | `f1_35` (page 1) | text | 16 Add lines 10 through 15b 16 |
| Line 17: Adjusted total income | `f1_36` (page 1) | text | (loss). Subtract line 16 from line 9 17 |
| Line 18: Income distribution deduction | `f1_37` (page 1) | text | line 15). Attach Schedules K-1 (Form 1041) 18 |
| Line 21: Exemption | `f1_40` (page 1) | text | 21 Exemption 21 |
| Line 22: Add lines 18 through 21 | `f1_41` (page 1) | text | 22 Add lines 18 through 21 22 |
| Line 23: Taxable income | `f1_42` (page 1) | text | line 17. If a loss, see instructions 23 |
| Line 24: Total tax | `f1_43` (page 1) | text | (from Schedule G, Part I, line 9) 24 |
| Schedule B line 1 | `f2_8` (page 2) | text | 1 Adjusted total income. See instructions 1 |
| Schedule B line 2 | `f2_9` (page 2) | text | 2 Adjusted tax-exempt interest 2 |
| Schedule B line 3 | `f2_10` (page 2) | text | 1041), line 19, column (1). See instructions 3 |
| Schedule B line 6 | `f2_13` (page 2) | text | positive number 6 |
| Schedule B line 7: Distributable net income | `f2_14` (page 2) | text | 6. If zero or less, enter -0- 7 |
| Schedule B line 8: Accounting income | `f2_15` (page 2) | text | the governing instrument and applicable local law 8 |
| Schedule B line 9 | `f2_16` (page 2) | text | 9 Income required to be distributed currently 9 |
| Schedule B line 10 | `f2_17` (page 2) | text | credited, or otherwise required to be distributed 10 |
| Schedule B line 11 | `f2_18` (page 2) | text | If greater than line 8, see instructions 11 |
| Schedule B line 12 | `f2_19` (page 2) | text | of tax-exempt income included on line 11 12 |
| Schedule B line 13 | `f2_20` (page 2) | text | deduction. Subtract line 12 from line 11 13 |
| Schedule B line 14 | `f2_21` (page 2) | text | 7. If zero or less, enter -0- 14 |
| Schedule B line 15: Income distribution deduction | `f2_22` (page 2) | text | here and on page 1, line 18 15 |
| Schedule G line 1a: Tax on taxable income | `f2_23` (page 2) | text | a Tax on taxable income. See instructions 1a |
| Schedule G line 1e | `f2_27` (page 2) | text | e Total. Add lines 1a through 1d 1e |
| Schedule G line 3 | `f2_33` (page 2) | text | 1e. If zero or less, enter -0- 3 |
| Schedule G line 9: Total tax | `f2_42` (page 2) | text | here and on page 1, line 24 9 |
| Other Information 1: Yes | `c3_2[0]` (page 3) | checkbox | attach a computation of the allocation of expenses. |
| Other Information 1: No | `c3_2[1]` (page 3) | checkbox | attach a computation of the allocation of expenses. |
| Other Information 1: tax-exempt amount | `f3_13` (page 3) | text | of tax-exempt interest income and exempt-interest dividends $ |
| Other Information 2: Yes | `c3_3[0]` (page 3) | checkbox | reason of a contract assignment or similar arrangement? |
| Other Information 2: No | `c3_3[1]` (page 3) | checkbox | reason of a contract assignment or similar arrangement? |
| Other Information 3: Yes | `c3_4[0]` (page 3) | checkbox | or other financial account in a foreign country? |
| Other Information 3: No | `c3_4[1]` (page 3) | checkbox | or other financial account in a foreign country? |
| Other Information 4: Yes | `c3_5[0]` (page 3) | checkbox | 3520-A. See instructions |
| Other Information 4: No | `c3_5[1]` (page 3) | checkbox | 3520-A. See instructions |
| Other Information 5: Yes | `c3_6[0]` (page 3) | checkbox | the instructions for the required attachment |
| Other Information 5: No | `c3_6[1]` (page 3) | checkbox | the instructions for the required attachment |
| Other Information 9: Yes | `c3_10[0]` (page 3) | checkbox | or future trust beneficiaries skip persons? See instructions |
| Other Information 9: No | `c3_10[1]` (page 3) | checkbox | or future trust beneficiaries skip persons? See instructions |
| Other Information 10: Yes | `c3_11[0]` (page 3) | checkbox | Form 8938 |
| Other Information 10: No | `c3_11[1]` (page 3) | checkbox | Form 8938 |
| Other Information 11a: No | `c3_12[1]` (page 3) | checkbox | for which it made a section 965(i) election? |
| Other Information 12: No | `c3_14[1]` (page 3) | checkbox | last day of the tax year? See instructions |
| Other Information 13: Yes | `c3_15[0]` (page 3) | checkbox | instructions |
| Other Information 13: No | `c3_15[1]` (page 3) | checkbox | instructions |

## sources/f1041sd_2025.pdf

| Return line | PDF field | Type | Printed beside the field |
|---|---|---|---|
| Name of estate or trust | `f1_01` (page 1) | text | Name of estate or trust |
| Employer identification number | `f1_02` (page 1) | text | Employer identification number |
| Line 1a (d) Proceeds | `f1_03` (page 1) | text | this line blank and go to line 1b |
| Line 1a (e) Cost | `f1_04` (page 1) | text | this line blank and go to line 1b |
| Line 1a (h) Gain or (loss) | `f1_06` (page 1) | text | this line blank and go to line 1b |
| Line 6: Short-term capital loss carryover | `f1_21` (page 1) | text | Carryover Worksheet 6 ( |
| Line 7: Net short-term capital gain or (loss) | `f1_22` (page 1) | text | Part III, line 17, column (3) 7 |
| Line 8a (d) Proceeds | `f1_23` (page 1) | text | this line blank and go to line 8b |
| Line 8a (e) Cost | `f1_24` (page 1) | text | this line blank and go to line 8b |
| Line 8a (h) Gain or (loss) | `f1_26` (page 1) | text | this line blank and go to line 8b |
| Line 13: Capital gain distributions | `f1_41` (page 1) | text | 13 Capital gain distributions 13 |
| Line 15: Long-term capital loss carryover | `f1_43` (page 1) | text | Carryover Worksheet 15 ( |
| Line 16: Net long-term capital gain or (loss) | `f1_44` (page 1) | text | Part III, line 18a, column (3) 16 |
| Line 17 column (1) Beneficiaries | `f2_01` (page 2) | text | 17 Net short-term gain or (loss) 17 |
| Line 17 column (2) Trust | `f2_02` (page 2) | text | 17 Net short-term gain or (loss) 17 |
| Line 17 column (3) Total | `f2_03` (page 2) | text | 17 Net short-term gain or (loss) 17 |
| Line 18a column (1) | `f2_04` (page 2) | text | a Total for year 18a |
| Line 18a column (2) | `f2_05` (page 2) | text | a Total for year 18a |
| Line 18a column (3) | `f2_06` (page 2) | text | a Total for year 18a |
| Line 19 column (1) | `f2_13` (page 2) | text | or (loss). Combine lines 17 and 18a 19 |
| Line 19 column (2) | `f2_14` (page 2) | text | or (loss). Combine lines 17 and 18a 19 |
| Line 19 column (3) | `f2_15` (page 2) | text | or (loss). Combine lines 17 and 18a 19 |
| Line 20: Capital loss limitation | `f2_16` (page 2) | text | 19, column (3); or b $3,000 20 ( |
| Part V line 21 | `f2_17` (page 2) | text | (or Form 990-T, Part I, line 11) 21 |
| Part V line 22 | `f2_18` (page 2) | text | less than zero 22 |
| Part V line 23 | `f2_19` (page 2) | text | income in Part I of Form 990-T) 23 |
| Part V line 24 | `f2_20` (page 2) | text | 24 Add lines 22 and 23 24 |
| Part V line 25 | `f2_21` (page 2) | text | amount from line 4g; otherwise, enter -0- 25 |
| Part V line 26 | `f2_22` (page 2) | text | 24. If zero or less, enter -0- 26 |
| Part V line 27 | `f2_23` (page 2) | text | 21. If zero or less, enter -0- 27 |
| Part V line 28 | `f2_24` (page 2) | text | the amount on line 21 or $3,250 28 |
| Part V line 29 | `f2_25` (page 2) | text | amount on line 27 or line 28 29 |
| Part V line 30 | `f2_26` (page 2) | text | -0-. This amount is taxed at 0% 30 |
| Part V line 31 | `f2_27` (page 2) | text | smaller of line 21 or line 26 31 |
| Part V line 32 | `f2_28` (page 2) | text | 32 Subtract line 30 from line 26 32 |
| Part V line 33 | `f2_29` (page 2) | text | the smaller of line 21 or $15,900 33 |
| Part V line 34 | `f2_30` (page 2) | text | 34 Add lines 27 and 30 34 |
| Part V line 35 | `f2_31` (page 2) | text | 33. If zero or less, enter -0- 35 |
| Part V line 36 | `f2_32` (page 2) | text | smaller of line 32 or line 35 36 |
| Part V line 37 | `f2_33` (page 2) | text | 37 Multiply line 36 by 15% (0.15) 37 |
| Part V line 38 | `f2_34` (page 2) | text | 38 Enter the amount from line 31 38 |
| Part V line 39 | `f2_35` (page 2) | text | 39 Add lines 30 and 36 39 |
| Part V line 40 | `f2_36` (page 2) | text | 38. If zero or less, enter -0- 40 |
| Part V line 41 | `f2_37` (page 2) | text | 41 Multiply line 40 by 20% (0.20) 41 |
| Part V line 42 | `f2_38` (page 2) | text | instructions in the Instructions for Form 1041 42 |
| Part V line 43 | `f2_39` (page 2) | text | 43 Add lines 37, 41, and 42 43 |
| Part V line 44 | `f2_40` (page 2) | text | instructions in the Instructions for Form 1041 44 |
| Part V line 45 | `f2_41` (page 2) | text | (or Form 990-T, Part II, line 2) 45 |

## sources/f1041sk1_2025.pdf

| Return line | PDF field | Type | Printed beside the field |
|---|---|---|---|
| Final K-1 | `c1_1[0]` (page 1) | checkbox | Final K-1 Amended |
| A: Estate's or trust's EIN | `f1_6` (page 1) | text | Estate’s or trust’s employer identification number A |
| B: Estate's or trust's name | `f1_7` (page 1) | text | Estate’s or trust’s name B |
| C: Fiduciary's name, address, city, state, and ZIP code | `f1_8` (page 1) | text | Fiduciary’s name, address, city, state, and ZIP |
| E: Final Form 1041 for the estate or trust | `c1_3` (page 1) | checkbox | E |
| F: Beneficiary's identifying number | `f1_10` (page 1) | text | Beneficiary’s identifying number F |
| G: Beneficiary's name, address, city, state, and ZIP code | `f1_11` (page 1) | text | Beneficiary’s name, address, city, state, and ZIP |
| Box 1: Interest income | `f1_12` (page 1) | text | Interest income |
| Box 2a: Ordinary dividends | `f1_13` (page 1) | text | Ordinary dividends |
| Box 2b: Qualified dividends | `f1_14` (page 1) | text | Credits, etc. See back of form and instructions. |
| Box 3: Net short-term capital gain | `f1_15` (page 1) | text | A Estate’s or trust’s employer identification number |
| Box 4a: Net long-term capital gain | `f1_16` (page 1) | text | Net long-term capital gain |
| Box 14: Other information, code | `f1_56` (page 1) | text | final Form 1041 for the estate or trust |
| Box 14: Other information, amount | `f1_57` (page 1) | text | final Form 1041 for the estate or trust |
