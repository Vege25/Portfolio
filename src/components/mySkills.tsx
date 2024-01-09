import React from 'react';
import LightButton from './buttons/lightButton';

const MySkills: React.FC = () => {
  return (
    <aside>
      <h3 className='mt-16 text-xl font-bold lg:my-4'>My skills</h3>
      <div className='flex flex-wrap gap-2'>
        <LightButton text='Javascript' />
        <LightButton text='Typescript' />
        <LightButton text='HTML' />
        <LightButton text='CSS' />
        <LightButton text='React' />
        <LightButton text='Node' />
        <LightButton text='Express' />
        <LightButton text='SQL' />
        <LightButton text='jQuery' />
        <LightButton text='Bootstrap' />
        <LightButton text='SASS' />
        <LightButton text='Github' />
      </div>
    </aside>
  );
};

export default MySkills;
